const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticate, authorizeConsumer, authorizeConsumerAccess } = require('../middleware/auth');
const Consumer = require('../models/Consumer');
const MeterReading = require('../models/MeterReading');
const SystemConfig = require('../models/SystemConfig');
const { syncFirebaseReadingsForConsumer } = require('../services/firebaseService');

const router = express.Router();

function startAndEndOfBillingCycle(billingCycle, fallbackStartDate) {
  if (billingCycle && /^\d{4}-\d{2}$/.test(billingCycle)) {
    const [year, month] = billingCycle.split('-').map(Number);
    const startDate = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
    const endDate = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
    return { startDate, endDate, billingCycle };
  }

  const refDate = fallbackStartDate ? new Date(fallbackStartDate) : new Date();
  const year = refDate.getUTCFullYear();
  const month = refDate.getUTCMonth();
  const startDate = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  const endDate = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));
  const normalizedCycle = `${year}-${String(month + 1).padStart(2, '0')}`;
  return { startDate, endDate, billingCycle: normalizedCycle };
}

function previousBillingCycle(billingCycle) {
  if (!billingCycle || !/^\d{4}-\d{2}$/.test(billingCycle)) {
    return null;
  }
  const [year, month] = billingCycle.split('-').map(Number);
  const ref = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  ref.setUTCMonth(ref.getUTCMonth() - 1);
  return `${ref.getUTCFullYear()}-${String(ref.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthIndex(billingCycle) {
  if (!billingCycle || !/^\d{4}-\d{2}$/.test(billingCycle)) {
    return Number.NEGATIVE_INFINITY;
  }
  const [year, month] = billingCycle.split('-').map(Number);
  return year * 12 + (month - 1);
}

function latestEnergyBeforeCycle(targetCycle, monthEnergyMap) {
  const targetIndex = monthIndex(targetCycle);
  let bestIndex = Number.NEGATIVE_INFINITY;
  let bestEnergy = 0;

  for (const [cycle, energy] of monthEnergyMap.entries()) {
    const idx = monthIndex(cycle);
    if (idx < targetIndex && idx > bestIndex) {
      bestIndex = idx;
      bestEnergy = Number(energy) || 0;
    }
  }

  return bestEnergy;
}

function calculateBillFromConfig(unitsConsumed, billingConfig = {}) {
  const units = Math.max(0, Number(unitsConsumed) || 0);
  const slabRates = Array.isArray(billingConfig.slabRates) ? billingConfig.slabRates : [];
  let remaining = units;
  let previousLimit = 0;
  let slabAmount = 0;
  const computedSlabs = [];

  if (slabRates.length > 0) {
    for (const slab of slabRates) {
      if (remaining <= 0) break;
      const maxUnitsInSlab = slab.uptoKWh ? Math.max(0, slab.uptoKWh - previousLimit) : remaining;
      const slabUnits = Math.min(remaining, maxUnitsInSlab);
      const amount = slabUnits * (Number(slab.rate) || 0);

      computedSlabs.push({
        slabMin: previousLimit + 1,
        slabMax: slab.uptoKWh || null,
        rate: Number(slab.rate) || 0,
        units: slabUnits,
        amount
      });

      slabAmount += amount;
      remaining -= slabUnits;
      previousLimit = slab.uptoKWh || previousLimit + slabUnits;
    }
  } else {
    const ratePerUnit = Number(billingConfig.ratePerUnit) || 0;
    slabAmount = units * ratePerUnit;
    computedSlabs.push({
      slabMin: 1,
      slabMax: null,
      rate: ratePerUnit,
      units,
      amount: slabAmount
    });
  }

  const fixedCharges = Number(billingConfig.fixedCharges) || 0;
  const electricityDutyPct = Number(billingConfig.electricityDutyPct) || 0;
  const fuelAdjustmentRate = Number(billingConfig.fuelAdjustmentRate) || 0;
  const otherCharges = Number(billingConfig.otherCharges) || 0;
  const electricityDuty = (slabAmount + fixedCharges) * (electricityDutyPct / 100);
  const fuelAdjustment = units * fuelAdjustmentRate;
  const totalAmount = slabAmount + fixedCharges + electricityDuty + fuelAdjustment + otherCharges;

  return {
    tariffDetails: {
      slabRates: computedSlabs,
      fixedCharges,
      taxes: {
        electricityDuty,
        fuelAdjustment,
        otherCharges
      }
    },
    billAmount: {
      slabCharges: slabAmount,
      fixedCharges,
      taxes: electricityDuty + fuelAdjustment + otherCharges,
      totalAmount,
      roundedBill: Math.round(totalAmount)
    }
  };
}

// Get consumer profile
router.get('/profile', authenticate, authorizeConsumer, async (req, res) => {
  try {
    res.status(200).json({
      status: 'success',
      data: {
        consumer: req.user
      }
    });
  } catch (error) {
    console.error('Get consumer profile error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

// Update consumer profile
router.put('/profile', authenticate, authorizeConsumer, [
  body('name').optional().trim().isLength({ min: 2, max: 100 }),
  body('phone').optional().trim().isLength({ min: 6, max: 20 }).withMessage('Phone number must be between 6 and 20 characters'),
  body('address.street').optional().trim().isLength({ min: 1, max: 200 }),
  body('address.city').optional().trim().isLength({ min: 1, max: 100 }),
  body('address.state').optional().trim().isLength({ min: 1, max: 100 }),
  body('address.pincode').optional().trim().matches(/^[0-9]{6}$/).withMessage('Pincode must be 6 digits')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        status: 'error',
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const updateFields = req.body;
    
    // Remove sensitive fields that shouldn't be updated via this endpoint
    delete updateFields.password;
    delete updateFields.email;
    delete updateFields.consumerNumber;
    delete updateFields.status;

    const updatedConsumer = await Consumer.findByIdAndUpdate(
      req.user._id,
      updateFields,
      { new: true, runValidators: true }
    );

    res.status(200).json({
      status: 'success',
      message: 'Profile updated successfully',
      data: {
        consumer: updatedConsumer
      }
    });

  } catch (error) {
    console.error('Update consumer profile error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

// Get consumer's current meter reading
router.get('/meter/current', authenticate, authorizeConsumer, async (req, res) => {
  try {
    const latestReading = await MeterReading.getLatestReading(req.user._id);
    
    if (!latestReading) {
      return res.status(404).json({
        status: 'error',
        message: 'No meter readings found'
      });
    }

    res.status(200).json({
      status: 'success',
      data: {
        reading: latestReading
      }
    });

  } catch (error) {
    console.error('Get current meter reading error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

// Get consumer's meter reading history
router.get('/meter/history', authenticate, authorizeConsumer, async (req, res) => {
  try {
    const { page = 1, limit = 10, startDate, endDate } = req.query;
    const skip = (page - 1) * limit;

    let query = { consumerId: req.user._id };
    
    // Add date range filter if provided
    if (startDate || endDate) {
      query.timestamp = {};
      if (startDate) query.timestamp.$gte = new Date(startDate);
      if (endDate) query.timestamp.$lte = new Date(endDate);
    }

    const readings = await MeterReading.find(query)
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('readBy', 'name adminId');

    const totalReadings = await MeterReading.countDocuments(query);

    res.status(200).json({
      status: 'success',
      data: {
        readings,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(totalReadings / limit),
          totalReadings,
          hasNext: page * limit < totalReadings,
          hasPrev: page > 1
        }
      }
    });

  } catch (error) {
    console.error('Get meter reading history error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

// Get consumer's energy consumption analytics
router.get('/analytics/consumption', authenticate, authorizeConsumer, async (req, res) => {
  try {
    const { period = 'monthly' } = req.query;
    let groupBy, dateFormat;

    switch (period) {
      case 'daily':
        groupBy = { $dateToString: { format: "%Y-%m-%d", date: "$timestamp" } };
        dateFormat = 'daily';
        break;
      case 'weekly':
        groupBy = { 
          $dateToString: { 
            format: "%Y-W%U", 
            date: "$timestamp" 
          } 
        };
        dateFormat = 'weekly';
        break;
      case 'monthly':
      default:
        groupBy = { $dateToString: { format: "%Y-%m", date: "$timestamp" } };
        dateFormat = 'monthly';
        break;
    }

    const analytics = await MeterReading.aggregate([
      { $match: { consumerId: req.user._id } },
      {
        $group: {
          _id: groupBy,
          totalConsumption: { $sum: "$reading.unitsConsumed" },
          averageConsumption: { $avg: "$reading.unitsConsumed" },
          maxConsumption: { $max: "$reading.unitsConsumed" },
          minConsumption: { $min: "$reading.unitsConsumed" },
          readingsCount: { $sum: 1 },
          averageVoltage: { $avg: "$powerQuality.voltage" },
          averagePowerFactor: { $avg: "$powerQuality.powerFactor" }
        }
      },
      { $sort: { _id: -1 } },
      { $limit: 12 } // Last 12 periods
    ]);

    // Calculate total consumption and cost estimates
    const totalConsumption = analytics.reduce((sum, item) => sum + item.totalConsumption, 0);
    const averageMonthlyConsumption = totalConsumption / (analytics.length || 1);

    res.status(200).json({
      status: 'success',
      data: {
        period: dateFormat,
        analytics,
        summary: {
          totalConsumption,
          averageMonthlyConsumption,
          periodsAnalyzed: analytics.length
        }
      }
    });

  } catch (error) {
    console.error('Get consumption analytics error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

// Get consumer's billing history
router.get('/billing/history', authenticate, authorizeConsumer, async (req, res) => {
  try {
    const { page = 1, limit = 10, month, autoSync = 'true' } = req.query;
    const pageNumber = parseInt(page, 10) || 1;
    const limitNumber = parseInt(limit, 10) || 10;
    const skip = (pageNumber - 1) * limitNumber;

    if (String(autoSync).toLowerCase() !== 'false') {
      try {
        await syncFirebaseReadingsForConsumer({ consumer: req.user, limit: 10000 });
      } catch (syncError) {
        console.warn('Auto sync before billing fetch failed:', syncError.message);
      }
    }

    const [configDoc, readings] = await Promise.all([
      SystemConfig.findOne({ key: 'default' }).lean(),
      MeterReading.find({ consumerId: req.user._id })
        .sort({ timestamp: -1 })
        .lean()
    ]);

    const billingConfig = configDoc?.billing || {};
    const cycleMap = new Map();

    for (const reading of readings) {
      const rawCycle = reading?.readingPeriod?.billingCycle;
      const normalized = startAndEndOfBillingCycle(rawCycle, reading?.readingPeriod?.startDate || reading?.timestamp);
      if (!cycleMap.has(normalized.billingCycle)) {
        cycleMap.set(normalized.billingCycle, {
          _id: reading._id,
          consumerId: reading.consumerId,
          meterId: reading.meterId,
          status: reading.status,
          createdAt: reading.createdAt,
          updatedAt: reading.updatedAt,
          readingPeriod: {
            billingCycle: normalized.billingCycle,
            startDate: normalized.startDate,
            endDate: normalized.endDate
          },
          reading: {
            totalUnits: 0,
            previousReading: Number(reading?.reading?.previousReading) || 0,
            currentReading: Number(reading?.reading?.currentReading) || 0,
            unitsConsumed: 0
          },
          _energyMin: null,
          _energyMax: null,
          _latestActiveEnergy: null,
          latestTimestamp: new Date(reading?.timestamp || reading?.updatedAt || reading?.createdAt || 0).getTime()
        });
      }

      const bucket = cycleMap.get(normalized.billingCycle);
      bucket.reading.unitsConsumed += Number(reading?.reading?.unitsConsumed) || 0;
      bucket.reading.totalUnits = bucket.reading.unitsConsumed;

      const activeEnergy = Number(reading?.energyMetrics?.activeEnergy);
      if (Number.isFinite(activeEnergy)) {
        if (bucket._energyMin === null || activeEnergy < bucket._energyMin) {
          bucket._energyMin = activeEnergy;
        }
        if (bucket._energyMax === null || activeEnergy > bucket._energyMax) {
          bucket._energyMax = activeEnergy;
        }
      }

      const readingTs = new Date(reading?.timestamp || reading?.updatedAt || reading?.createdAt || 0).getTime();
      if (readingTs >= bucket.latestTimestamp) {
        bucket.latestTimestamp = readingTs;
        bucket.reading.currentReading = Number(reading?.reading?.currentReading) || bucket.reading.currentReading;
        bucket.reading.previousReading = Number(reading?.reading?.previousReading) || bucket.reading.previousReading;
        bucket._latestActiveEnergy = Number.isFinite(activeEnergy) ? activeEnergy : bucket._latestActiveEnergy;
        bucket.status = reading.status || bucket.status;
        bucket._id = reading._id || bucket._id;
      }
    }

    const monthEnergyMap = new Map();
    for (const item of cycleMap.values()) {
      const monthKey = String(item?.readingPeriod?.billingCycle || '');
      const latestEnergy = Number(item?._latestActiveEnergy);
      const fallbackCurrent = Number(item?.reading?.currentReading);
      const monthEnergy = Number.isFinite(latestEnergy)
        ? latestEnergy
        : (Number.isFinite(fallbackCurrent) ? fallbackCurrent : 0);
      monthEnergyMap.set(monthKey, monthEnergy);
    }

    let cycleBills = Array.from(cycleMap.values())
      .map((item) => {
        const monthKey = String(item?.readingPeriod?.billingCycle || '');
        const currentReading = monthEnergyMap.get(monthKey) || 0;
        const previousReading = latestEnergyBeforeCycle(monthKey, monthEnergyMap);
        const derivedUnits = Math.max(0, currentReading - previousReading);

        item.reading.currentReading = Number(currentReading.toFixed(3));
        item.reading.previousReading = Number(previousReading.toFixed(3));
        item.reading.unitsConsumed = Number(derivedUnits.toFixed(3));
        item.reading.totalUnits = item.reading.unitsConsumed;

        delete item._energyMin;
        delete item._energyMax;
        delete item._latestActiveEnergy;
        return item;
      })
      .sort((a, b) => String(b?.readingPeriod?.billingCycle || '').localeCompare(String(a?.readingPeriod?.billingCycle || '')));

    if (month && /^\d{4}-\d{2}$/.test(month)) {
      cycleBills = cycleBills.filter((item) => item?.readingPeriod?.billingCycle === month);
    }

    // If there are no meter readings yet, provide a computed current-month bill shell
    // so billing config changes are still visible on the consumer bill page.
    if (cycleBills.length === 0) {
      const now = new Date();
      const fallbackCycle = (month && /^\d{4}-\d{2}$/.test(month))
        ? month
        : `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
      const normalized = startAndEndOfBillingCycle(fallbackCycle);
      const previousReading = latestEnergyBeforeCycle(fallbackCycle, monthEnergyMap);
      const currentReading = previousReading;
      cycleBills = [{
        _id: `synthetic-${req.user._id}-${fallbackCycle}`,
        consumerId: req.user._id,
        meterId: req.user?.meterDetails?.meterId || null,
        reading: {
          totalUnits: 0,
          previousReading: Number(previousReading.toFixed(3)),
          currentReading: Number(currentReading.toFixed(3)),
          unitsConsumed: 0
        },
        readingPeriod: {
          billingCycle: normalized.billingCycle,
          startDate: normalized.startDate,
          endDate: normalized.endDate
        },
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
        synthetic: true
      }];
    }

    const totalBills = cycleBills.length;
    const pagedBills = cycleBills.slice(skip, skip + limitNumber);

    const processedBills = pagedBills.map((reading) => {
      const unitsConsumed = reading?.reading?.unitsConsumed || 0;
      const computed = calculateBillFromConfig(unitsConsumed, billingConfig);
      const dueDays = Number(billingConfig?.dueDays) || 15;
      const dueDate = new Date(reading.readingPeriod.endDate);
      dueDate.setUTCDate(dueDate.getUTCDate() + dueDays);

      return {
        ...reading,
        tariffDetails: computed.tariffDetails,
        billAmount: computed.billAmount,
        billDate: reading.readingPeriod.endDate,
        dueDate
      };
    });

    res.status(200).json({
      status: 'success',
      data: {
        bills: processedBills,
        pagination: {
          currentPage: pageNumber,
          totalPages: Math.ceil(totalBills / limitNumber),
          totalBills,
          hasNext: pageNumber * limitNumber < totalBills,
          hasPrev: pageNumber > 1
        }
      }
    });

  } catch (error) {
    console.error('Get billing history error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

// Update consumer preferences
router.put('/preferences', authenticate, authorizeConsumer, [
  body('notifications.email').optional().isBoolean(),
  body('notifications.sms').optional().isBoolean(),
  body('notifications.push').optional().isBoolean(),
  body('theme').optional().isIn(['light', 'dark']),
  body('language').optional().isLength({ min: 2, max: 5 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        status: 'error',
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const updatedConsumer = await Consumer.findByIdAndUpdate(
      req.user._id,
      { $set: { preferences: req.body } },
      { new: true, runValidators: true }
    );

    res.status(200).json({
      status: 'success',
      message: 'Preferences updated successfully',
      data: {
        preferences: updatedConsumer.preferences
      }
    });

  } catch (error) {
    console.error('Update preferences error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

module.exports = router;
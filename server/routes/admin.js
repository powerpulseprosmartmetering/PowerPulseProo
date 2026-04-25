const express = require('express');
const { authenticate, authorizeAdmin, authorizePermission } = require('../middleware/auth');
const Admin = require('../models/Admin');
const Consumer = require('../models/Consumer');
const MeterReading = require('../models/MeterReading');
const Event = require('../models/Event');
const SystemConfig = require('../models/SystemConfig');

const router = express.Router();

function flattenReadingsTree(tree) {
  if (!tree || typeof tree !== 'object') return [];
  const out = [];

  Object.entries(tree).forEach(([dateKey, hoursObj]) => {
    if (!hoursObj || typeof hoursObj !== 'object') return;
    Object.entries(hoursObj).forEach(([hourKey, readingsObj]) => {
      if (!readingsObj || typeof readingsObj !== 'object') return;
      Object.entries(readingsObj).forEach(([tsKey, rec]) => {
        const tsNum = Number(tsKey);
        if (!Number.isFinite(tsNum)) return;
        const timestamp = tsKey.length <= 10 ? tsNum * 1000 : tsNum;
        out.push({ dateKey, hourKey, timestamp, raw: rec || {} });
      });
    });
  });

  return out.sort((a, b) => a.timestamp - b.timestamp);
}

function normalizeBillingCycle(tsMs) {
  const d = new Date(tsMs);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const billingCycle = `${year}-${String(month + 1).padStart(2, '0')}`;
  const startDate = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  const endDate = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));
  return { billingCycle, startDate, endDate };
}

function toNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

// Get all consumers (with pagination and search)
router.get('/consumers', authenticate, authorizeAdmin, authorizePermission('read-consumers'), async (req, res) => {
  try {
    const { page = 1, limit = 10, search, status, connectionType } = req.query;
    const skip = (page - 1) * limit;

    let query = {};
    
    // Add search filter
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { consumerNumber: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    // Add status filter
    if (status) {
      query.status = status;
    }

    // Add connection type filter
    if (connectionType) {
      query.connectionType = connectionType;
    }

    const consumers = await Consumer.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const totalConsumers = await Consumer.countDocuments(query);

    res.status(200).json({
      status: 'success',
      data: {
        consumers,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(totalConsumers / limit),
          totalConsumers,
          hasNext: page * limit < totalConsumers,
          hasPrev: page > 1
        }
      }
    });

  } catch (error) {
    console.error('Get consumers error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

// Get dashboard statistics
router.get('/dashboard/stats', authenticate, authorizeAdmin, async (req, res) => {
  try {
    const totalConsumers = await Consumer.countDocuments();
    const activeConsumers = await Consumer.countDocuments({ status: 'active' });
    const totalReadings = await MeterReading.countDocuments();
    const todayReadings = await MeterReading.countDocuments({
      timestamp: {
        $gte: new Date(new Date().setHours(0, 0, 0, 0)),
        $lt: new Date(new Date().setHours(23, 59, 59, 999))
      }
    });

    // Get tamper alerts count
    const tamperAlerts = await MeterReading.countDocuments({
      'tamperDetection.detected': true,
      timestamp: {
        $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // Last 30 days
      }
    });

    res.status(200).json({
      status: 'success',
      data: {
        totalConsumers,
        activeConsumers,
        inactiveConsumers: totalConsumers - activeConsumers,
        totalReadings,
        todayReadings,
        tamperAlerts
      }
    });

  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

// Get live details for a specific consumer (used by admin panel)
router.get('/consumers/:consumerId/live', authenticate, authorizeAdmin, authorizePermission('read-consumers'), async (req, res) => {
  try {
    const { consumerId } = req.params;
    const { limit = 20 } = req.query;
    const cappedLimit = Math.min(100, Math.max(5, parseInt(limit, 10) || 20));

    const consumer = await Consumer.findById(consumerId);
    if (!consumer) {
      return res.status(404).json({
        status: 'error',
        message: 'Consumer not found'
      });
    }

    const [latestReading, recentReadings, recentEvents] = await Promise.all([
      MeterReading.findOne({ consumerId }).sort({ timestamp: -1 }).lean(),
      MeterReading.find({ consumerId })
        .sort({ timestamp: -1 })
        .limit(cappedLimit)
        .select('meterId timestamp reading powerQuality tamperDetection status')
        .lean(),
      Event.find({ consumerId })
        .sort({ occurredAt: -1 })
        .limit(cappedLimit)
        .lean()
    ]);

    res.status(200).json({
      status: 'success',
      data: {
        consumer,
        latestReading,
        recentReadings,
        recentEvents
      }
    });
  } catch (error) {
    console.error('Get consumer live details error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

// Meter on/off control for a consumer
router.patch('/consumers/:consumerId/meter-power', authenticate, authorizeAdmin, authorizePermission('write-consumers'), async (req, res) => {
  try {
    const { consumerId } = req.params;
    const { powerState } = req.body;

    if (!['on', 'off'].includes(powerState)) {
      return res.status(400).json({
        status: 'error',
        message: 'powerState must be either "on" or "off"'
      });
    }

    // Stronger control for meter OFF: only trusted roles with system-level permission.
    if (powerState === 'off') {
      const roleAllowed = ['super-admin', 'admin'].includes(req.user.role);
      const hasSystemPermission = req.user.permissions.includes('system-settings');
      if (!roleAllowed || !hasSystemPermission) {
        return res.status(403).json({
          status: 'error',
          message: 'Only authorized admins can turn OFF a meter'
        });
      }
    }

    const nextStatus = powerState === 'off' ? 'disconnected' : 'active';

    const consumer = await Consumer.findByIdAndUpdate(
      consumerId,
      { $set: { status: nextStatus } },
      { new: true }
    );

    if (!consumer) {
      return res.status(404).json({
        status: 'error',
        message: 'Consumer not found'
      });
    }

    await Event.create({
      type: 'System',
      severity: powerState === 'off' ? 'Warning' : 'Info',
      detail: `Meter power turned ${powerState.toUpperCase()} by admin ${req.user.adminId || req.user.name || 'unknown'}`,
      source: consumer?.meterDetails?.meterId || consumer.consumerNumber,
      consumerId: consumer._id,
      raw: {
        action: 'meter-power-control',
        powerState,
        adminId: req.user.adminId || null
      },
      autoGenerated: false
    });

    res.status(200).json({
      status: 'success',
      message: `Meter turned ${powerState.toUpperCase()} successfully`,
      data: { consumer }
    });
  } catch (error) {
    console.error('Meter power control error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

// Get system configuration
router.get('/config', authenticate, authorizeAdmin, authorizePermission('system-settings'), async (req, res) => {
  try {
    const config = await SystemConfig.findOneAndUpdate(
      { key: 'default' },
      { $setOnInsert: { key: 'default' } },
      { upsert: true, new: true }
    );

    res.status(200).json({
      status: 'success',
      data: { config }
    });
  } catch (error) {
    console.error('Get system config error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

// Update specific configuration section
router.put('/config/:section', authenticate, authorizeAdmin, authorizePermission('system-settings'), async (req, res) => {
  try {
    const { section } = req.params;
    const allowedSections = ['thresholds', 'sampling', 'billing', 'security'];

    if (!allowedSections.includes(section)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid config section'
      });
    }

    const payload = req.body || {};
    const update = {};

    Object.entries(payload).forEach(([key, value]) => {
      update[`${section}.${key}`] = value;
    });

    const config = await SystemConfig.findOneAndUpdate(
      { key: 'default' },
      {
        $set: update,
        $setOnInsert: { key: 'default' }
      },
      { upsert: true, new: true, runValidators: true }
    );

    res.status(200).json({
      status: 'success',
      message: `${section} updated successfully`,
      data: { config }
    });
  } catch (error) {
    console.error('Update system config error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

// Schedule maintenance/firmware operations
router.post('/operations/schedule', authenticate, authorizeAdmin, authorizePermission('system-settings'), async (req, res) => {
  try {
    const { type } = req.body;
    if (!['firmware-update', 'maintenance'].includes(type)) {
      return res.status(400).json({
        status: 'error',
        message: 'type must be firmware-update or maintenance'
      });
    }

    const setField = type === 'firmware-update'
      ? { 'operations.lastFirmwareScheduleAt': new Date() }
      : { 'operations.lastMaintenanceScheduleAt': new Date() };

    await SystemConfig.findOneAndUpdate(
      { key: 'default' },
      {
        $set: setField,
        $setOnInsert: { key: 'default' }
      },
      { upsert: true, new: true }
    );

    await Event.create({
      type: 'System',
      severity: 'Info',
      detail: `${type} scheduled by admin ${req.user.adminId || req.user.name || 'unknown'}`,
      source: 'ADMIN-CONSOLE',
      raw: { operationType: type },
      autoGenerated: false
    });

    res.status(200).json({
      status: 'success',
      message: `${type} scheduled successfully`
    });
  } catch (error) {
    console.error('Schedule operation error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

// Import readings from Firebase Realtime DB to Mongo for billing/monthly history sync
router.post('/operations/import-readings', authenticate, authorizeAdmin, authorizePermission('system-settings'), async (req, res) => {
  try {
    const { consumerId, limit = 5000 } = req.body || {};

    let consumer = null;
    if (consumerId) {
      consumer = await Consumer.findById(consumerId);
    } else {
      consumer = await Consumer.findOne({ status: 'active' }).sort({ createdAt: 1 });
    }

    if (!consumer) {
      return res.status(404).json({
        status: 'error',
        message: 'No target consumer found for import'
      });
    }

    const dbUrl = process.env.FIREBASE_DATABASE_URL
      || process.env.VITE_FIREBASE_DATABASE_URL
      || 'https://powerpulsepro-e3f49-default-rtdb.asia-southeast1.firebasedatabase.app';

    const readingsUrl = `${dbUrl.replace(/\/$/, '')}/Readings.json`;
    const firebaseRes = await fetch(readingsUrl);
    if (!firebaseRes.ok) {
      throw new Error(`Failed to fetch Firebase readings (${firebaseRes.status})`);
    }

    const tree = await firebaseRes.json();
    const flatReadings = flattenReadingsTree(tree).slice(-Math.max(1, Math.min(50000, Number(limit) || 5000)));

    if (!flatReadings.length) {
      return res.status(200).json({
        status: 'success',
        message: 'No Firebase readings available to import',
        data: { imported: 0, skipped: 0, totalSource: 0 }
      });
    }

    const meterId = consumer?.meterDetails?.meterId || 'PPPRO-001';
    let imported = 0;
    let skipped = 0;
    let syntheticCurrentReading = 0;
    let prevEnergy = null;

    // Prime synthetic reading baseline from latest Mongo entry for continuity.
    const lastMongo = await MeterReading.findOne({ consumerId: consumer._id }).sort({ timestamp: -1 }).lean();
    if (lastMongo?.reading?.currentReading) {
      syntheticCurrentReading = Number(lastMongo.reading.currentReading) || 0;
    }

    for (const item of flatReadings) {
      const tsDate = new Date(item.timestamp);
      if (!Number.isFinite(tsDate.getTime())) {
        skipped += 1;
        continue;
      }

      const existing = await MeterReading.findOne({
        consumerId: consumer._id,
        meterId,
        timestamp: tsDate
      }).select('_id').lean();

      if (existing) {
        skipped += 1;
        continue;
      }

      const raw = item.raw || {};
      const voltage = clamp(raw.Voltage ?? raw.voltage, 0, 500, 230);
      const current = Math.max(0, toNum(raw.Current ?? raw.current, 0));
      const frequency = clamp(raw.Frequency ?? raw.frequency, 45, 65, 50);
      const powerFactor = clamp(raw.PF ?? raw.powerFactor, 0, 1, 0.9);
      const energyVal = toNum(raw.Energy ?? raw.energyToday, 0);

      let unitsConsumed = 0;
      if (prevEnergy !== null) {
        const diff = energyVal - prevEnergy;
        unitsConsumed = diff > 0 ? diff : 0;
      }
      prevEnergy = energyVal;

      const previousReading = syntheticCurrentReading;
      syntheticCurrentReading += unitsConsumed;
      const currentReading = syntheticCurrentReading;

      const { billingCycle, startDate, endDate } = normalizeBillingCycle(item.timestamp);

      const doc = new MeterReading({
        consumerId: consumer._id,
        meterId,
        reading: {
          totalUnits: currentReading,
          previousReading,
          currentReading,
          unitsConsumed
        },
        powerQuality: {
          voltage,
          current,
          frequency,
          powerFactor,
          thd: 5
        },
        energyMetrics: {
          activeEnergy: energyVal,
          reactiveEnergy: 0,
          apparentEnergy: 0,
          peakDemand: toNum(raw.Power ?? raw.ActivePower, 0),
          loadFactor: 0.7
        },
        timestamp: tsDate,
        readingType: 'automatic',
        readingPeriod: {
          startDate,
          endDate,
          billingCycle
        },
        status: 'active',
        qualityFlags: {
          dataIntegrity: true,
          calibrationStatus: true,
          communicationQuality: 'good'
        },
        notes: 'Imported from Firebase sync'
      });

      await doc.save();
      imported += 1;
    }

    await Event.create({
      type: 'System',
      severity: 'Info',
      detail: `Imported ${imported} readings (skipped ${skipped}) for consumer ${consumer.consumerNumber}`,
      source: meterId,
      consumerId: consumer._id,
      raw: { imported, skipped, totalSource: flatReadings.length },
      autoGenerated: false
    });

    res.status(200).json({
      status: 'success',
      message: 'Readings import sync completed',
      data: {
        consumerId: consumer._id,
        consumerNumber: consumer.consumerNumber,
        imported,
        skipped,
        totalSource: flatReadings.length
      }
    });
  } catch (error) {
    console.error('Import readings sync error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to import readings'
    });
  }
});

module.exports = router;
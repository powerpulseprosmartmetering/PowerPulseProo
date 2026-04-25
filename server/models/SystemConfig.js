const mongoose = require('mongoose');

const systemConfigSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true,
    default: 'default'
  },
  thresholds: {
    overVoltage: { type: Number, default: 250 },
    overCurrent: { type: Number, default: 15 },
    tamperDetection: { type: Boolean, default: true }
  },
  sampling: {
    sampleIntervalSeconds: { type: Number, default: 30 },
    reportIntervalMinutes: { type: Number, default: 5 },
    billingRate: { type: Number, default: 0.12 }
  },
  billing: {
    fixedCharges: { type: Number, default: 120 },
    ratePerUnit: { type: Number, default: 6.5 },
    electricityDutyPct: { type: Number, default: 5 },
    fuelAdjustmentRate: { type: Number, default: 0.25 },
    otherCharges: { type: Number, default: 25 },
    dueDays: { type: Number, default: 15 },
    slabRates: [{
      uptoKWh: { type: Number, min: 1 },
      rate: { type: Number, min: 0 }
    }]
  },
  security: {
    twoFactorRequired: { type: Boolean, default: false },
    strictUserPermissions: { type: Boolean, default: true }
  },
  operations: {
    lastFirmwareScheduleAt: Date,
    lastMaintenanceScheduleAt: Date
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('SystemConfig', systemConfigSchema);

const MeterReading = require('../models/MeterReading');

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

async function syncFirebaseReadingsForConsumer({ consumer, limit = 5000 }) {
	if (!consumer || !consumer._id) {
		throw new Error('Consumer is required for Firebase sync');
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
		return {
			imported: 0,
			skipped: 0,
			totalSource: 0,
			meterId: consumer?.meterDetails?.meterId || 'PPPRO-001'
		};
	}

	const meterId = consumer?.meterDetails?.meterId || 'PPPRO-001';
	let imported = 0;
	let skipped = 0;
	let syntheticCurrentReading = 0;
	let prevEnergy = null;

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

	return {
		imported,
		skipped,
		totalSource: flatReadings.length,
		meterId
	};
}

module.exports = {
	syncFirebaseReadingsForConsumer
};

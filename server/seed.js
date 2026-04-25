const mongoose = require('mongoose');
const Consumer = require('./models/Consumer');
const Admin = require('./models/Admin');
require('dotenv').config();

// Default credentials
const DEFAULT_CONSUMER = {
  consumerNumber: '2214110559',
  name: 'Adi Bhongale',
  email: 'adi.bhongale@powerpulse.com',
  phone: '+91-9822000000',
  password: '9822@Adi',
  address: {
    street: '123 Smart Energy Street',
    city: 'Pune',
    state: 'Maharashtra',
    pincode: '411001',
    country: 'India'
  },
  meterDetails: {
    meterId: 'MET2214110559',
    meterType: 'single-phase',
    installationDate: new Date('2024-01-15'),
    capacity: 5.0
  },
  connectionType: 'domestic',
  tariffPlan: 'basic',
  status: 'active',
  isVerified: true
};

const DEFAULT_ADMIN = {
  adminId: 'ADMIN001',
  personalInfo: {
    fullName: 'Demo Admin',
    email: 'powerpulsepro.smartmetering@gmail.com',
    phoneNumber: '+91-9876543211'
  },
  password: 'admin123',
  role: 'super_admin',
  permissions: {
    'read-consumers': true,
    'write-consumers': true,
    'read-billing': true,
    'write-billing': true,
    'read-alerts': true,
    'write-alerts': true,
    'read-meters': true,
    'write-meters': true,
    'system-settings': true,
    'user-management': true,
    'reports-access': true
  },
  status: 'active'
};

async function seedDatabase() {
  try {
    console.log('🌱 Starting database seeding...');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/powerpulsepro');
    console.log('✅ Connected to MongoDB');

    // Check if default consumer already exists
    const existingConsumer = await Consumer.findOne({ 
      consumerNumber: DEFAULT_CONSUMER.consumerNumber 
    });

    if (!existingConsumer) {
      // Create default consumer with the plain password; the model pre-save hook
      // hashes it exactly once.
      const consumer = new Consumer(DEFAULT_CONSUMER);

      await consumer.save();
      console.log('✅ Default consumer created:');
      console.log(`   Consumer Number: ${DEFAULT_CONSUMER.consumerNumber}`);
      console.log(`   Email: ${DEFAULT_CONSUMER.email}`);
      console.log(`   Password: ${DEFAULT_CONSUMER.password}`);
    } else {
      // Refresh the existing record so any previously double-hashed password is
      // replaced with a correctly hashed value.
      existingConsumer.set({
        ...DEFAULT_CONSUMER,
        password: DEFAULT_CONSUMER.password
      });
      await existingConsumer.save();
      console.log('ℹ️  Default consumer already existed; credentials refreshed');
    }

    const existingAdmin = await Admin.findOne({ adminId: DEFAULT_ADMIN.adminId });

    if (!existingAdmin) {
      const admin = new Admin({
        ...DEFAULT_ADMIN,
        name: DEFAULT_ADMIN.personalInfo.fullName,
        email: DEFAULT_ADMIN.personalInfo.email,
        phone: DEFAULT_ADMIN.personalInfo.phoneNumber,
        role: DEFAULT_ADMIN.role.replace('_', '-'),
        permissions: Object.entries(DEFAULT_ADMIN.permissions)
          .filter(([, enabled]) => enabled)
          .map(([permission]) => permission)
      });

      await admin.save();
      console.log('✅ Default admin created:');
      console.log(`   Admin ID: ${DEFAULT_ADMIN.adminId}`);
      console.log(`   Email: ${DEFAULT_ADMIN.personalInfo.email}`);
      console.log(`   Password: ${DEFAULT_ADMIN.password}`);
    } else {
      existingAdmin.set({
        adminId: DEFAULT_ADMIN.adminId,
        name: DEFAULT_ADMIN.personalInfo.fullName,
        email: DEFAULT_ADMIN.personalInfo.email,
        phone: DEFAULT_ADMIN.personalInfo.phoneNumber,
        role: DEFAULT_ADMIN.role.replace('_', '-'),
        permissions: Object.entries(DEFAULT_ADMIN.permissions)
          .filter(([, enabled]) => enabled)
          .map(([permission]) => permission),
        status: DEFAULT_ADMIN.status,
        password: DEFAULT_ADMIN.password
      });
      await existingAdmin.save();
      console.log('ℹ️  Default admin already existed; credentials refreshed');
    }

    console.log('✅ Consumer account ready in MongoDB Atlas!');

    console.log('\n🎉 Database seeding completed successfully!');
    console.log('\n📋 Default Login Credentials:');
    console.log('┌─────────────────────────────────────────┐');
    console.log('│              CONSUMER LOGIN             │');
    console.log('├─────────────────────────────────────────┤');
    console.log(`│ Consumer Number: ${DEFAULT_CONSUMER.consumerNumber}      │`);
    console.log(`│ Email: ${DEFAULT_CONSUMER.email}    │`);
    console.log(`│ Password: ${DEFAULT_CONSUMER.password}                │`);
    console.log('└─────────────────────────────────────────┘');
    console.log('┌─────────────────────────────────────────┐');
    console.log('│               ADMIN LOGIN               │');
    console.log('├─────────────────────────────────────────┤');
    console.log(`│ Admin ID: ${DEFAULT_ADMIN.adminId}                  │`);
    console.log(`│ Email: ${DEFAULT_ADMIN.personalInfo.email}    │`);
    console.log(`│ Password: ${DEFAULT_ADMIN.password}                      │`);
    console.log('└─────────────────────────────────────────┘');

  } catch (error) {
    console.error('❌ Database seeding failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB');
    process.exit(0);
  }
}

// Run seeder
if (require.main === module) {
  seedDatabase();
}

module.exports = { seedDatabase, DEFAULT_CONSUMER, DEFAULT_ADMIN };
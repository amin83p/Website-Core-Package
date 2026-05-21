// MVC/models/userDateTimeModel.js
const fs = require('fs').promises;
const path = require('path');
const dataPath = path.join(__dirname, '../../data/UserDateTime.json');
const systemConfigPath = path.join(__dirname, '../../config/systemConfig.json');

async function getUserTimeConstraints(userId) {
  try {
    const data = await fs.readFile(dataPath, 'utf8');
    const constraints = JSON.parse(data);
    return constraints.find(u => u.userId === userId) || null;
  } catch (error) {
    console.error(`Error reading UserDateTime.json for userId ${userId}:`, error);
    throw new Error('Failed to retrieve user time constraints');
  }
}

async function getSystemTimeConstraints() {
  try {
    // Step 1: System-wide working hours check
    const systemConfigData = await fs.readFile(systemConfigPath, 'utf8');

    return systemConfigData;
  } catch (error) {
    console.error('system Time check model error:', error);
    throw new Error(error);
  }
}

module.exports = { getUserTimeConstraints, getSystemTimeConstraints };
// MVC/middleware/timeCheckMiddleware.js
const fs = require('fs').promises;
const path = require('path');
const { getUserTimeConstraints, getSystemTimeConstraints } = require('../models/userDateTimeModel');


async function timeCheckMiddleware(req, res, next) {
  try {
    if (req.path === '/time-restricted' || req.path === '/user-restricted' || req.path === '/logout'){
      return next();
    }
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentDay = now.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat

    // Step 1: System-wide working hours check
    const systemConfigData = await getSystemTimeConstraints();
    const systemConfig = JSON.parse(systemConfigData);
    const { startTime, endTime, days } = systemConfig.workingHours;

    const [startHour, startMin] = startTime.split(':').map(Number);
    const [endHour, endMin] = endTime.split(':').map(Number);

    const currentTimeInMin = currentHour * 60 + currentMinute;
    const startTimeInMin = startHour * 60 + startMin;
    const endTimeInMin = endHour * 60 + endMin;

    const isValidSystemTime = days.includes(currentDay) && currentTimeInMin >= startTimeInMin && currentTimeInMin <= endTimeInMin;
    if (!isValidSystemTime) {
      console.log(`System time violation at ${now}: Outside working hours (${startTime} - ${endTime}, Mon-Fri)`);
      //req.session.reason = { startTime, endTime, days: getDayNamesText(days) };
      return res.redirect(`/time-restricted?startTime=${startTime}&endTime=${endTime}&days=${encodeURIComponent(getDayNamesText(days))}`);
    }

    // Step 2: User-specific time frame check (if user is authenticated)
    if (req.user) {
      const userConstraints = await getUserTimeConstraints(req.user.id);
      
      if (userConstraints) {
        const { startTime: userStart, endTime: userEnd, allowedDays } = userConstraints.allowedHours;
        const [userStartHour, userStartMin] = userStart.split(':').map(Number);
        const [userEndHour, userEndMin] = userEnd.split(':').map(Number);

        const userStartTimeInMin = userStartHour * 60 + userStartMin;
        const userEndTimeInMin = userEndHour * 60 + endMin;

        const isValidUserTime = allowedDays.includes(currentDay) && 
                                currentTimeInMin >= userStartTimeInMin && 
                                currentTimeInMin <= userEndTimeInMin;

        if (!isValidUserTime) {
          console.log(`User time violation for ${req.user.username} at ${now}: Outside user allowed hours (${userStart} - ${userEnd}, days: ${allowedDays})`);
          //return res.redirect(`/user-restricted?reason=user&username=${req.user.username}`);
          return res.redirect(`/user-restricted?startTime=${startTime}&endTime=${endTime}&days=${encodeURIComponent(getDayNamesText(days))}`);
        }
      } else {
        console.warn(`No time constraints found for user ${req.user.username}`);
      }
    }

    next();
  } catch (error) {
    console.error('Time check middleware error:', error);
    res.status(500).json({ message: 'Server error during time validation' });
  }
}

function getDayNamesText(dayNumbers) {
  const dayNames = [
    "Sunday",    // 1 corresponds to Sunday (if you want Monday as 1, adjust accordingly)
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday"
  ];

  // Adjust if 1-based dayNumbers use Monday=1 to Sunday=7:
  // const dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

  // Map numbers to day names, assuming dayNumbers are 1-based and 1 = Sunday
  const names = dayNumbers.map(num => dayNames[num - 1]);

  // Join with comma and space
  return names.join(", ");
}

module.exports = { timeCheckMiddleware };
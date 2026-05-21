// MVC/controllers/restrictedController.js
function timeRestricted(req, res) {
  const reason = {startTime: req.query.startTime, endTime: req.query.endTime, days: req.query.days };
  res.render('login/time-restricted', {
    title: 'Access Restricted - System Hours',
    //layout: 'layouts/layout',
    pageCss: 'page/login/restricted.css',
    reason,
    user: req.user || null
  });
}

function userRestricted(req, res) {
  const reason = {startTime: req.query.startTime, endTime: req.query.endTime, days: req.query.days };
  console.log(JSON.stringify(req.user));
  res.render('login/user-restricted', {
    title: 'Access Restricted - User Hours',
    //layout: 'layouts/layout',
    pageCss: 'page/login/restricted.css',
    reason,
    user: req.user || null
  });
}

module.exports = { timeRestricted, userRestricted };
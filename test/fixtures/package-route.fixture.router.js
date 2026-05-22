function packageRouteFixtureRouter(_req, _res, next) {
  if (typeof next === 'function') next();
}

module.exports = packageRouteFixtureRouter;

function packageOwnedRouteFixture(_req, _res, next) {
  if (typeof next === 'function') next();
}

module.exports = packageOwnedRouteFixture;

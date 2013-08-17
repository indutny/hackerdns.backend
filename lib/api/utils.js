// Top-Level domain parser
exports.tld = function tld(domain) {
  var match = domain.match(/([a-z0-9\-]+\.[a-z]{2,6})\.?$/);
  if (!match)
    return false;

  return match[1];
};

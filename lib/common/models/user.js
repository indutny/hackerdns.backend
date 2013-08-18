var async = require('async');
var resourceful = require('resourceful');
var Domain = null;

var User = resourceful.define('User', function() {
  this.key = 'email';

  this.string('email', { format: 'email', required: true }).sanitize('lower');
  this.string('pbkdf2', { required: true });
  this.string('salt', { required: true });
  this.number('iterations', { required: true });
  this.array('domains', { required: true }).sanitize(function(val) {
    return val || [];
  });

  this.timestamps();
});
module.exports = User;

User.prototype.createDomain = function createDomain(domain, callback) {
  var self = this;
  if (!Domain)
    Domain = require('./domain');

  domain.owner = this.key;
  domain = new Domain(domain);
  domain.save(function(err) {
    if (err)
      return callback(err);

    if (self.domains.indexOf(domain.key) === -1)
      self.domains.push(domain.key);
    self.save(function(err) {
      if (err) {
        domain.destroy(function() { /* ignore errors */ });
        return callback(err);
      }

      callback(null, domain);
    });
  });
};

User.prototype.getDomains = function getDomains(callback) {
  if (!Domain)
    Domain = require('./domain');

  async.map(this.domains, function(domain, callback) {
    Domain.get(domain, callback);
  }, callback);
};

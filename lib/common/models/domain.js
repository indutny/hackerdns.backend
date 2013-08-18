var resourceful = require('resourceful');
var User = null;

var Domain = resourceful.define('Domain', function() {
  this.key = 'domain';

  this.string('owner', {
    required: true
  });

  this.string('domain', {
    required: true,
    pattern: /^[a-z0-9_\-]+\.[a-z]{2,6}$/i
  }).sanitize('lower');

  this.array('records', {
    required: true,
    items: {
      required: false,
      type: 'object',
      properties: {
        sub: { required: true, type: 'string' },
        type: {
          required: true,
          type: 'string',
          enum: [ 'A', 'MX', 'NS', 'CNAME', 'TXT' ]
        },
        ttl: { required: true, type: 'number' },
        data: { required: true, type: 'any' }
      }
    }
  }).sanitize(function(val) {
    if (!Array.isArray(val) && val)
      return;

    var records = val || [];
    return records.map(function(record) {
      return {
        sub: record.sub || '',
        type: (record.type + '').toUpperCase(),
        ttl: record.ttl,
        data: record.data
      };
    });
  });

  this.timestamps();

  this.filter('bySubdomain', {
    map: function (doc) {
      if (doc.resource === 'Domain')
        doc.records.forEach(function(record) {
          var domain = doc.domain.replace(/^domain\//, '');
          domain = record.sub ? record.sub + '.' + domain :
                                domain;
          emit(record.type + '/' + domain, {
            ttl: record.ttl,
            data: record.data
          });
        });
    }
  });

  this.filter('byOwner', { include_docs: true }, {
    map: function (doc) {
      if (doc.resource === 'Domain')
        emit(doc.owner, { _id: doc._id });
    }
  });
});
module.exports = Domain;

Domain.after('destroy', function(e, obj, next) {
  if (e)
    return next(e);

  if (!User)
    User = require('./user');
  User.get(obj.owner, function(err, user) {
    if (err)
      return next(null);

    var index = user.domains.indexOf(obj.key);
    if (index === -1)
      return next(null);

    user.domains.splice(index, 1);
    user.save(function() {
      // Ignore errors
      callback(null);
    });
  });
});

Domain.prototype.user = function user(callback) {
  if (!User)
    User = require('./user');

  User.get(this.owner, callback);
};

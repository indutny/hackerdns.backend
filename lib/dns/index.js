var util = require('util');
var dnsd = require('dnsd');
var async = require('async');

var common = require('../common');
var utils = common.utils;
var Domain = common.models.Domain;

function Server(conf) {
  common.Server.call(this, conf, 'dns');

  this.server = dnsd.createServer.defaults({
    ttl: 60
  })(this.handler.bind(this));
};
util.inherits(Server, common.Server);
exports.Server = Server;

exports.createServer = function createServer(conf) {
  return new Server(conf);
};

Server.prototype.handler = function handler(req, res) {
  var self = this;

  this.probe('request');

  var glue = false;
  function addZone(type, domain, callback) {
    var tld = utils.tld(domain.toLowerCase());
    Domain.get(tld, function(err, domain) {
      if (err)
        return callback(null, []);

      var results = [];
      if (type === 'SOA')
        results.push({
          type: 'SOA',
          name: tld,
          data: {
            'mname': self.conf.get('dns:mname'),
            'rname': self.conf.get('dns:rname'),
            'serial': (domain.mtime / 1e3) | 0,
            'refresh': self.conf.get('dns:refresh'),
            'retry'  : self.conf.get('dns:retry'),
            'expire' : self.conf.get('dns:expire'),
            'ttl'    : self.conf.get('dns:ttl')
          },
          ttl: self.conf.get('dns:ttl')
        });
      if (type === 'NS') {
        self.conf.get('dns:ns').forEach(function(ns) {
          results.push({
            type: 'NS',
            name: tld,
            data: ns.host,
            ttl: self.conf.get('dns:ttl')
          });
          if (!glue)
            res.additional.push({
              type: 'A',
              name: ns.host,
              data: ns.ip,
              ttl: self.conf.get('dns:ttl')
            });
        });
        glue = true;
      }
      callback(null, results);
    });
  }

  async.map(res.question, function(query, callback) {
    var results = [];
    var waiting = 1;
    var errs = [];
    function next(err, answers) {
      if (err)
        errs.push(err);
      else
        results = results.concat(answers);
      if (--waiting === 0)
        callback(errs.length !== 0 && errs, results);
    }

    // Check if we've any records about the domain
    if (query.type.toUpperCase() === 'SOA' ||
        query.type.toUpperCase() === 'NS') {
      if (query.type.toUpperCase() === 'NS')
        waiting++;
      addZone(query.type.toUpperCase(), query.name, next);
      if (query.type.toUpperCase() === 'SOA')
        return;
    }

    var key = query.type.toUpperCase() + '/' +
              query.name.toLowerCase();
    Domain.bySubdomain(key, function(err, items) {
      if (err)
        return next(null, []);
      next(null, items);
    });
  }, function(err, answers) {
    if (err)
      return res.end();

    answers.forEach(function(items, i) {
      if (!items)
        return;
      var question = res.question[i];
      if (!question)
        return;

      items.forEach(function(item) {
        res.answer.push({
          name: item.name || question.name,
          type: item.type || question.type,
          data: item.data,
          ttl: item.ttl | 0
        });
      });
    });

    // XXX This is a bit hacky, but should work
    if (res.answer.length === 0 && req.question.length > 0) {
      // No answers - add soa
      addZone('SOA', req.question[0].name, function(err, soa) {
        if (err)
          return res.end();
        soa.forEach(function(record) {
          res.answer.push(record);
        });
        res.end();
      });
      return;
    }

    res.end();
  });
};

Server.prototype.start = function start(callback) {
  var waiting = 2;
  this.server.listen(this.conf.get('dns:port'),
                     this.conf.get('dns:hostname'));
  this.server.on('listening', callback);
};

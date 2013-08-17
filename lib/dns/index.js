var util = require('util');
var dnsd = require('dnsd');

var common = require('../common');

function Server(conf) {
  common.Server.call(this, conf, 'dns');

  this.server = dnsd.createServer(this.handler.bind(this));
};
util.inherits(Server, common.Server);
exports.Server = Server;

exports.createServer = function createServer(conf) {
  return new Server(conf);
};

Server.prototype.handler = function handler(req, res) {
  var self = this;
  var multi = this.db.multi();

  this.probe('request');

  res.question.forEach(function(query) {
    var key = self.dbKey('domain',
                         query.name.toLowerCase(),
                         query.type.toLowerCase());
    multi.smembers(key);
  })

  multi.exec(function(err, answers) {
    if (err)
      return res.end('127.0.0.1');

    answers.forEach(function(items, i) {
      var question = res.question[i];
      if (!question)
        return;

      items = items.map(function(item) {
        try {
          return JSON.parse(item);
        } catch (e) {
          return null;
        }
      }).filter(function(item) {
        return item;
      });

      var type = question.type.toLowerCase();
      items.forEach(function(item) {
        res.answer.push({
          name: question.name,
          type: question.type,
          data: item.data,
          ttl: item.ttl | 0
        });
      });
    });

    res.end();
  });
};

Server.prototype.start = function start(callback) {
  var waiting = 2;
  this.server.listen(this.conf.get('dns:port'),
                     this.conf.get('dns:hostname'));
  this.server.on('listening', callback);
};

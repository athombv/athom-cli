'use strict';

module.exports.Log = console.log;
module.exports.Settings = new (require('./lib/Settings'));
module.exports.AthomApi = new (require('./lib/AthomApi'));
module.exports.App = require('./lib/App');
module.exports.Animation = require('./lib/Animation');
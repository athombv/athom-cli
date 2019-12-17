'use strict';

/*
	Plugin ID: log

	This plugin installs homey-log.

	Enable the plugin by adding `{ "id": "log" }` to your /.homeyplugins.json array

	Plugin options:
	{
		"version": "latest"
	}
*/

const AppPlugin = require('../AppPlugin');

const NpmCommands = require('../Modules/NpmCommands');

class AppPluginLog extends AppPlugin {

  async run() {
    await NpmCommands.install({ save: true }, {
      id: 'homey-log',
      version: this._options.version,
    });
  }

}

module.exports = AppPluginLog;
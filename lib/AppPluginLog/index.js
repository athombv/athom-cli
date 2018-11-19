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

const fs = require('fs');
const path = require('path');

const fse = require('fs-extra');

const AppPlugin = require('../AppPlugin');

class AppPluginLog extends AppPlugin {

	async run() {
		await this._app.installNpmPackage({
			id: 'homey-log',
			version: this._options.version,
		});
	}

}

module.exports = AppPluginLog;
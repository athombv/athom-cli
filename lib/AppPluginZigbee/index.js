'use strict';

/*
	Plugin ID: zigbee

	This plugin installs homey-meshdriver.

	Enable the plugin by adding `{ "id": "zigbee" }` to your /.homeyplugins.json array

	Plugin options:
	{
		"version": "latest"
	}
*/

const path = require('path');

const fse = require('fs-extra');

const AppPlugin = require('../AppPlugin');

const NpmCommands = require('../Modules/NpmCommands');

class AppPluginZigbee extends AppPlugin {

	async run() {
    await NpmCommands.install({ save: true }, {
      id: 'homey-meshdriver',
      version: this._options.version,
    });
	}

	static createDriverQuestions() {
		return [
			{
				type: 'confirm',
				name: 'isZigbee',
				default: false,
				message: 'Is this a Zigbee device?',
				when: answers => !answers.isZwave,
			}
		]
	}

	static async createDriver({ app, driverPath, answers, driverJson }) {
		await app.addPlugin('zigbee');
    await NpmCommands.install({ save: true }, {
      id: 'homey-meshdriver',
      version: 'latest',
    });

		await fse.copy(
			path.join(app.path, 'node_modules', 'homey-meshdriver', 'assets', 'driver', 'zigbee', 'device.js'),
			path.join(driverPath, 'device.js')
		);
		await fse.remove(
			path.join(driverPath, 'driver.js')
		);
	}

}

module.exports = AppPluginZigbee;
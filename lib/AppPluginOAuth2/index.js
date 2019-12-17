'use strict';

/*
	Plugin ID: oauth2

	This plugin installs homey-oauth2app.

	Enable the plugin by adding `{ "id": "oauth2" }` to your /.homeyplugins.json array

	Plugin options:
	{
		"version": "latest"
	}
*/

const AppPlugin = require('../AppPlugin');

const NpmCommands = require('../Modules/NpmCommands');

class AppPluginOAuth2 extends AppPlugin {

	async run() {
    await NpmCommands.install({ save: true }, {
      id: 'homey-oauth2app',
      version: this._options.version,
    });
  }

}

module.exports = AppPluginOAuth2;
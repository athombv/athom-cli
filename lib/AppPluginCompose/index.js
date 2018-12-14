'use strict';

/*
	Plugin ID: compose

	This plugin generates an app.json file based on scattered files,
	to make it easier to create apps with lots of functionality.

	It finds the following files:
	/.homeycompose/app.compose.json
	/.homeycompose/capabilities/<id>.json
	/.homeycompose/screensavers/<id>.json
	/.homeycompose/signals/<433|868|ir>/<id>.json
	/.homeycompose/flow/<triggers|conditions|actions>/<id>.json
	/.homeycompose/drivers/templates/<template_id>.json
	/.homeycompose/drivers/settings/<setting_id>.json
	/.homeycompose/drivers/flow/<triggers|conditions|actions>/<flow_id>.json (flow card object, id and device arg is added automatically)
	/drivers/<id>/driver.compose.json (extend with "$extends": [ "<template_id>" ])
	/drivers/<id>/driver.settings.compose.json (array with driver settings, extend with "$extends": "<template_id>"))
	/drivers/<id>/driver.flow.compose.json (object with flow cards, device arg is added automatically)
	/.homeycompose/locales/en.json
	/.homeycompose/locales/en.foo.json

	Enable the plugin by adding `{ "id": "compose" }` to your /.homeyplugins.json array

	Plugin options:
	{
		"appJsonSpace": 2 | 4 | "\t"
	}
*/

const fs = require('fs');
const path = require('path');
const util = require('util');

const fse = require('fs-extra');
const _ = require('underscore');
const deepmerge = require('deepmerge');
const objectPath = require('object-path');

const AppPlugin = require('../AppPlugin');

const readFileAsync = util.promisify( fs.readFile );
const writeFileAsync = util.promisify( fs.writeFile );
const copyFileAsync = util.promisify( fs.copyFile );

const FLOW_TYPES = [ 'triggers', 'conditions', 'actions' ];

class AppPluginCompose extends AppPlugin {

	async run() {

		this._appPath = this._app.path;
		this._appPathCompose = path.join(this._app.path, '.homeycompose');

		this._appJsonPath = path.join( this._appPath, 'app.json' );
		this._appJson = await this._getJsonFile(this._appJsonPath);

		this._appJsonPathCompose = path.join( this._appPathCompose, 'app.json' );
		try {
			this._appJson = await this._getJsonFile(this._appJsonPathCompose);
		} catch( err ) {
			if( err.code !== 'ENOENT' ) throw new Error(err);
		}

		await this._composeFlow();
		await this._composeDrivers();
		await this._composeCapabilities();
		await this._composeSignals();
		await this._composeScreensavers();
		await this._composeLocales();
		await this._saveAppJson();

	}

	/*
    Find drivers in /drivers/:id/driver.compose.json
	*/
	async _composeDrivers() {

		delete this._appJson.drivers;

		let drivers = await this._getFiles( path.join( this._appPath, 'drivers') );
		for( let i = 0; i < drivers.length; i++ ) {
			let driverId = drivers[i];
			if( driverId.indexOf('.') === 0) continue;

			// merge json
			let driverJson = await this._getJsonFile( path.join(this._appPath, 'drivers', driverId, 'driver.compose.json') );
			if( driverJson.$extends ) {

				if( !Array.isArray(driverJson.$extends) )
					driverJson.$extends = [ driverJson.$extends ];

				let templates = await this._getJsonFiles( path.join( this._appPathCompose, 'drivers', 'templates' ) );
				let templateJson = {};

				for( let j = 0; j < driverJson.$extends.length; j++ ) {
					let templateId = driverJson.$extends[j];
					templateJson = {
						...templateJson,
						...templates[templateId],
					}
				}

				driverJson = {
					...templateJson,
					...driverJson,
				}
			}

			driverJson.id = driverId;

			function extendSetting(settingsTemplates, settingObj) {
				if (settingObj.type === 'group') {
					for (let childSettingId in settingObj.children) {
						extendSetting(settingsTemplates, settingObj.children[childSettingId]);
					}
				} else if (settingObj.$extends) {
					let templateIds = [].concat(settingObj.$extends);

					let settingTemplate = {};
					let templateId;
					for (let i in templateIds) {
						templateId = templateIds[i];
						if (!settingsTemplates.hasOwnProperty(templateId)) {
							throw new Error(`Invalid driver setting template for driver ${driverId}: ${templateId}`);
						}
						settingTemplate = Object.assign(settingTemplate, settingsTemplates[templateId]);
					}

					Object.assign(settingObj, {
						id: settingObj.$id || templateId,
						...settingTemplate,
						...settingObj,
					});
				}
			}

			// merge settings
			try {
				driverJson.settings = await this._getJsonFile( path.join(this._appPath, 'drivers', driverId, 'driver.settings.compose.json') );
			} catch( err ) {
				if( err.code !== 'ENOENT' ) throw new Error(err);
			}

			// merge template settings
			try {
				let settingsTemplates = await this._getJsonFiles( path.join( this._appPathCompose, 'drivers', 'settings' ) );
				if (Array.isArray(driverJson.settings)) {
					for (let settingId in driverJson.settings) {
						extendSetting(settingsTemplates, driverJson.settings[settingId]);
					}
				}
			} catch (err) {
				if( err.code !== 'ENOENT' ) throw new Error(err);
			}

			// merge pair
			if( Array.isArray(driverJson.pair) ) {

				let appPairPath = path.join(this._appPath, 'drivers', driverId, 'pair');
				let composePairPath = path.join(this._appPathCompose, 'drivers', 'pair');
				let composePairViews = await this._getFiles( composePairPath );
					composePairViews = composePairViews.filter(view => {
						return view.indexOf('.') !== 0;
					})

				for( let j = 0; j < driverJson.pair.length; j++ ) {
					let driverPairView = driverJson.pair[j];

					if( driverPairView.$template ) {
						let viewId = driverPairView.id;
						let templateId = driverPairView.$template;
						if( !composePairViews.includes(templateId) )
							throw new Error(`Invalid pair template for driver ${driverId}: ${templateId}`);
                        if( !viewId || typeof viewId !== 'string' )
                            throw new Error(`Invalid pair template "id" property for driver ${driverId}: ${templateId}`);

						await fse.ensureDir(appPairPath);

						// copy html
						let html = await readFileAsync( path.join(composePairPath, templateId, 'index.html') );
							html = html.toString();
							html = html.replace(/{{assets}}/g, `${viewId}.assets`);
						await writeFileAsync( path.join(appPairPath, `${viewId}.html`), html );

						// copy assets
						let composePairAssetsPath = path.join(composePairPath, templateId, 'assets');
						if( await fse.exists( composePairAssetsPath ) ) {
							await fse.copy( composePairAssetsPath, path.join(appPairPath, `${viewId}.assets`) );
						}
					}

					// set pair options
					if( driverJson.$pairOptions ) {
						for( let viewId in driverJson.$pairOptions ) {
							let options = driverJson.$pairOptions[viewId];

							let view = _.findWhere(driverJson.pair, { id: viewId });
							if( view ) {
								view.options = view.options || {};
								Object.assign(view.options, options);
							}
						}
					}
				}
			}

			// merge flow
			try {
				driverJson.$flow = await this._getJsonFile( path.join(this._appPath, 'drivers', driverId, 'driver.flow.compose.json') );
			} catch( err ) {
				if( err.code !== 'ENOENT' ) throw new Error(err);
			}

			// replace properties
			let zwaveParameterIndex = null;
			function replaceSpecialPropertiesRecursive( obj ) {
				if( typeof obj !== 'object' || obj === null ) return obj;

				// store last found zwave parameter index
				if ( obj.hasOwnProperty('zwave') && obj.zwave.hasOwnProperty('index') ) {
					zwaveParameterIndex = obj.zwave.index;
				}

				for( let key in obj ) {
					if( typeof obj[key] === 'object' ) {
						obj[key] = replaceSpecialPropertiesRecursive(obj[key]);
					}
					if( typeof obj[key] === 'string' ) {
						obj[key] = obj[key].replace(/{{driverId}}/g, driverId);

						try {
							obj[key] = obj[key].replace(/{{driverName}}/g, driverJson.name.en);
							obj[key] = obj[key].replace(/{{driverNameEn}}/g, driverJson.name.en);
							obj[key] = obj[key].replace(/{{driverNameNl}}/g, driverJson.name.nl || driverJson.name.en);
						} catch( err ) {
							throw new Error(`Missing property \`name\` in driver ${driverId}`);
						}
						obj[key] = obj[key].replace(/{{driverPath}}/g, `/drivers/${driverId}`);
						obj[key] = obj[key].replace(/{{driverAssetsPath}}/g, `/drivers/${driverId}/assets`);

						if (zwaveParameterIndex) {
							obj[key] = obj[key].replace(/{{zwaveParameterIndex}}/g, zwaveParameterIndex);
						}
					}
				}
				return obj;
			}

			// get drivers flow templates
			let flowTemplates = {};
			try {
				for (let i = 0; i < FLOW_TYPES.length; i++) {
					let type = FLOW_TYPES[i];
					let typePath = path.join(this._appPathCompose, 'drivers', 'flow', type);
					flowTemplates[type] = await this._getJsonFiles(typePath);
				}
			} catch (err) {
				if( err.code !== 'ENOENT' ) throw new Error(err);
			}

			if(typeof driverJson.$flow === 'object' && !Array.isArray(driverJson.$flow)){
				for( let i = 0; i < FLOW_TYPES.length; i++ ) {
					let type = FLOW_TYPES[i];
					let cards = driverJson.$flow[ type ];
					if( !cards ) continue;

					for( let i = 0; i < cards.length; i++ ) {
						let card = cards[i];

						// extend card if possible
						if (card.$extends) {
							let templateIds = [].concat(card.$extends);
							let templateCards = flowTemplates[type];

							let flowTemplate = {};
							let templateId;
							for (let i in templateIds) {
								templateId = templateIds[i];
								if (!templateCards.hasOwnProperty(templateId)) {
									throw new Error(`Invalid driver flow template for driver ${driverId}: ${templateId}`);
								}
								flowTemplate = Object.assign(flowTemplate, templateCards[templateId]);
							}

							// assign template to original flow object
							Object.assign(card, {
								id: card.$id || templateId,
								...flowTemplate,
								...card
							});
						}

						const filter = card.$filter || '';

						card.args = card.args || [];
						card.args.unshift({
							type: 'device',
							name: card.$deviceName || 'device',
							filter: `driver_id=${driverId}` + (filter ? `&${filter}` : ''),
						})

						await this._addFlowCard({
							type,
							card,
						});
					}
				}
			}

			driverJson = replaceSpecialPropertiesRecursive(driverJson);

			// add driver to app.json
			this._appJson.drivers = this._appJson.drivers || [];
			this._appJson.drivers.push(driverJson);

			this.log(`Added Driver \`${driverId}\``)
		}
	}

	/*
		Find signals in /compose/signals/:frequency/:id
	*/
	async _composeSignals() {

		delete this._appJson.signals;

		let frequencies = [ '433', '868', 'ir' ];
		for( let i = 0; i < frequencies.length; i++ ) {
			let frequency = frequencies[i];

			let signals = await this._getJsonFiles( path.join( this._appPathCompose, 'signals', frequency ) );

			for( let signalId in signals ) {
				let signal = signals[signalId];
				signalId = signal.$id || path.basename( signalId, '.json' );

				this._appJson.signals = this._appJson.signals || {};
				this._appJson.signals[ frequency ] = this._appJson.signals[ frequency ] || {};
				this._appJson.signals[ frequency ][ signalId ] = signal;

				this.log(`Added Signal \`${signalId}\` for frequency \`${frequency}\``)

			}

		}

	}

	/*
		Find flow cards in /compose/flow/:type/:id
	*/
	async _composeFlow() {

		delete this._appJson.flow;

		for( let i = 0; i < FLOW_TYPES.length; i++ ) {
			let type = FLOW_TYPES[i];

			let typePath = path.join( this._appPathCompose, 'flow', type );
			let cards = await this._getJsonFiles( typePath );
			for( let cardId in cards ) {
				let card = cards[cardId];
				await this._addFlowCard({
					type,
					card,
					id: path.basename( cardId, '.json' )
				});
			}

		}
	}

	async _addFlowCard({ type, card, id }) {

		let cardId = card.$id || card.id || id;
		card.id = cardId;

		this._appJson.flow = this._appJson.flow || {};
		this._appJson.flow[ type ] = this._appJson.flow[ type ] || [];
		this._appJson.flow[ type ].push( card );

		this.log(`Added FlowCard \`${cardId}\` for type \`${type}\``)

	}

	async _composeScreensavers() {

		delete this._appJson.screensavers;

		let screensavers = await this._getJsonFiles( path.join(this._appPathCompose, 'screensavers') );
		for( let screensaverId in screensavers ) {
			let screensaver = screensavers[screensaverId];
				screensaver.name = screensaver.$name || screensaver.name || screensaverId;

			this._appJson.screensavers = this._appJson.screensavers || [];
			this._appJson.screensavers.push(screensaver);

			this.log(`Added Screensaver \`${screensaver.name}\``)
		}

	}

	async _composeCapabilities() {

		delete this._appJson.capabilities;

		let capabilities = await this._getJsonFiles( path.join(this._appPathCompose, 'capabilities') );
		for( let capabilityId in capabilities ) {
			let capability = capabilities[capabilityId];
			capabilityId = capability.$id || capabilityId;

			this._appJson.capabilities = this._appJson.capabilities || {};
			this._appJson.capabilities[ capabilityId ] = capability;

			this.log(`Added Capability \`${capabilityId}\``)
		}

	}

	/*
		Merge locales (deep merge). They are merged from long to small filename.

		Example files:
		/.homeycompose/locales/en.json
		/.homeycompose/locales/en.foo.json (will be placed under property `foo`)
		/.homeycompose/locales/en.foo.bar.json (will be placed under property `foo.bar`)
	*/

	async _composeLocales() {
		let appLocalesPath = path.join(this._appPath, 'locales');
		let appLocales = await this._getJsonFiles( appLocalesPath );
		let appLocalesChanged = [];

		let appComposeLocalesPath = path.join(this._appPathCompose, 'locales');
		let appComposeLocales = await this._getJsonFiles( appComposeLocalesPath );

		// sort locales to merge the longest paths first
		const sortedAppComposeLocaleIds = Object.keys(appComposeLocales)
			.sort((a, b) => b.split('.').length - a.split('.').length);

		for( let appComposeLocaleId of sortedAppComposeLocaleIds) {
			let appComposeLocale = appComposeLocales[appComposeLocaleId];
			let appComposeLocaleIdArray = path.basename( appComposeLocaleId, '.json').split('.');
			let appComposeLocaleLanguage = appComposeLocaleIdArray.shift();

			appLocales[appComposeLocaleLanguage] = appLocales[appComposeLocaleLanguage] || {};

			if( appComposeLocaleIdArray.length === 0 ) {
				appLocales[appComposeLocaleLanguage] = deepmerge( appLocales[appComposeLocaleLanguage], appComposeLocale );
			} else {
				let value = objectPath.get( appLocales[appComposeLocaleLanguage], appComposeLocaleIdArray ) || {};
				objectPath.set( appLocales[appComposeLocaleLanguage], appComposeLocaleIdArray, deepmerge( value, appComposeLocale ) );
			}

			if( !appLocalesChanged.includes(appComposeLocaleLanguage) ) {
				appLocalesChanged.push(appComposeLocaleLanguage)
			}
		}

		for( let i = 0; i < appLocalesChanged.length; i++ ) {
			let appLocaleId = appLocalesChanged[i];
			let appLocale = appLocales[appLocaleId];
			await writeFileAsync( path.join(appLocalesPath, `${appLocaleId}.json`), JSON.stringify(appLocale, false, this._options.appJsonSpace || 2) )
			this.log(`Added Locale \`${appLocaleId}\``)
		}

	}

	async _saveAppJson() {

		function removeDollarPropertiesRecursive( obj ) {
			if( typeof obj !== 'object' ) return obj;
			for( let key in obj ) {
				if( key.indexOf('$') === 0 ) {
					delete obj[key];
				} else {
					obj[key] = removeDollarPropertiesRecursive(obj[key]);
				}
			}
			return obj;
		}

		let json = JSON.parse(JSON.stringify(this._appJson));
			json = removeDollarPropertiesRecursive(json);

		await writeFileAsync( this._appJsonPath, JSON.stringify(json, false, this._options.appJsonSpace || 2) );
	}

}

module.exports = AppPluginCompose;
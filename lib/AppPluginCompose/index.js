'use strict';

const fs = require('fs');
const path = require('path');
const util = require('util');

const AppPlugin = require('../AppPlugin');

const writeFileAsync = util.promisify( fs.writeFile );

const FLOW_TYPES = [ 'triggers', 'conditions', 'actions' ];

/*
	This plugin generates an app.json file based on scattered files,
	to make it easier to create apps with lots of functionality.
	
	It finds the following files:
	/.homeycompose/app.compose.json
	/.homeycompose/capabilities/<id>.json
	/.homeycompose/screensavers/<id>.json
	/.homeycompose/signals/<433|868|ir>/<id>.json
	/.homeycompose/flow/<triggers|conditions|actions>/<id>.json
	/.homeycompose/drivers/templates/<template_id>.json
	/drivers/<id>/driver.compose.json (extend with "$extends": "<template_id>")
	/drivers/<id>/driver.settings.compose.json (array with driver settings)
	/drivers/<id>/driver.flow.compose.json (object with flow cards, device arg is added automatically)
	
	Enable the plugin by adding `{ "id": "compose" }` to your /.homeyplugins.json
	
	Plugin options:
	{
		"appJsonSpace": 2 | 4 | "\t"
	}
*/

class AppPluginCompose extends AppPlugin {
	
	async run() {
				
		this._appPath = this._app.path;
		this._appPathCompose = path.join(this._app.path, '.homeycompose');
		
		this._appJsonPath = path.join( this._appPath, 'app.json' );
		this._appJson = await this._getJsonFile(this._appJsonPath);
		
		this._appJsonPathCompose = path.join( this._appPathCompose, 'app.compose.json' );
		this._appJsonCompose = await this._getJsonFile(this._appJsonPathCompose);
		
		this._appJson = {
			...this._appJsonCompose,
			...this._appJson,
		}
		
		await this._composeFlow();
		await this._composeDrivers();
		await this._composeCapabilities();
		await this._composeSignals();
		await this._composeScreensavers();
		await this._composeLocales();
		await this._saveAppJson();
		
	}
	
	async _composeDrivers() {
		
		delete this._appJson.drivers;
		
		// find templates
		let templates = await this._getJsonFiles( path.join( this._appPathCompose, 'drivers', 'templates' ) );
		
		let drivers = await this._getFiles( path.join( this._appPath, 'drivers') );
		for( let i = 0; i < drivers.length; i++ ) {
			let driverId = drivers[i];
			if( driverId.indexOf('.') === 0) continue;
			
			let driverJson = await this._getJsonFile( path.join(this._appPath, 'drivers', driverId, 'driver.compose.json') );
			if( driverJson.$extends ) {
				driverJson = {
					...templates[driverJson.$extends],
					...driverJson,
				}
			}
			
			driverJson.id = driverId;
			
			try {
				let driverJsonFlow = await this._getJsonFile( path.join(this._appPath, 'drivers', driverId, 'driver.flow.compose.json') );
				
				for( let i = 0; i < FLOW_TYPES.length; i++ ) {
					let type = FLOW_TYPES[i];
					let cards = driverJsonFlow[ type ];
					if( !cards ) continue;
											
					for( let i = 0; i < cards.length; i++ ) {					
						let card = cards[i];
						
						card.args = cards.args || [];
						card.args.unshift({
							type: 'device',
							name: card.$deviceName || 'device',
							filter: `driver_id=${driverId}`
						})
						
						await this._addFlowCard({
							type,
							card,
						});
					}
				}
			} catch( err ) {
				if( err.code !== 'ENOENT' ) throw new Error(err);				
			}
			
			try {
				driverJson.settings = await this._getJsonFile( path.join(this._appPath, 'drivers', driverId, 'driver.settings.compose.json') );
			} catch( err ) {
				if( err.code !== 'ENOENT' ) throw new Error(err);				
			}
			
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
	
	async _composeLocales() {
		
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
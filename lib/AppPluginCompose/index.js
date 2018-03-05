'use strict';

const fs = require('fs');
const path = require('path');
const util = require('util');

const AppPlugin = require('../AppPlugin');

const readFileAsync = util.promisify( fs.readFile );
const writeFileAsync = util.promisify( fs.writeFile );

class AppPluginCompose extends AppPlugin {
	
	async run() {	
		
		let appJsonPath = path.join( this._app.path, 'app.json' );
		let appJson = await readFileAsync(appJsonPath);
			appJson = JSON.parse( appJson );
		
		let appComposePath = path.join( this._app.path, 'app.compose.json' );
		let appComposeJson = await readFileAsync(appComposePath);
			appComposeJson = JSON.parse( appComposeJson );
		
		if( Array.isArray(appComposeJson.drivers) ) {
			appJson.drivers = appComposeJson.drivers;
			
			for( let i = 0; i < appJson.drivers.length; i++ ) {
				
				let driverId = appJson.drivers[i].id;
				
				let driverJson = path.join( this._app.path, 'drivers', driverId, 'driver.compose.json' );
					driverJson = await readFileAsync(driverJson);
					driverJson = JSON.parse( driverJson );
					
				appJson.drivers[i] = {
					...driverJson,
					...appJson.drivers[i],
				}
				
				this.log(`Added driver \`${driverId}\``)
				
			}
		}
				
		await writeFileAsync( appJsonPath, JSON.stringify(appJson, false, 2) );
		
	}
	
}

module.exports = AppPluginCompose;
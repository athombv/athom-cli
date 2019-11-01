'use strict';

/*
	Plugin ID: zwave
	
	This plugin installs homey-meshdriver.
	
	Enable the plugin by adding `{ "id": "zwave" }` to your /.homeyplugins.json array
	
	Plugin options:
	{
		"version": "latest"
	}
*/

const fs = require('fs');
const path = require('path');

const fse = require('fs-extra');
const fetch = require('node-fetch');
const colors = require('colors');

const AppPlugin = require('../AppPlugin');

class AppPluginZwave extends AppPlugin {
	
	async run() {
		await this._app.installNpmPackage({
			id: 'homey-meshdriver',
			version: this._options.version,
		});
	}
	
	static createDriverQuestions() {
		return [
			{
				type: 'confirm',
				name: 'isZwave',
				default: false,
				message: 'Is this a Z-Wave device?'
			},
			{
				type: 'input',
				name: 'zwaveSigmaDetails',
				message: 'Enter the Sigma ID (four digits, found in the URL) at ' + colors.underline('https://products.z-wavealliance.org/') + ' or press [return] to skip',
				default: '',
				when: answers => answers.isZwave,
				filter: async input => {
					if( input === '' ) return '';
					let details = await AppPluginZwave.getSigmaDetails( input );
						details.toString = () => details.Name
					return details;
				}
			}
		]
	}
	
	static async createDriver({ app, driverPath, answers, driverJson }) {

		await app.addPlugin('zwave');
		await app.installNpmPackage({
			id: 'homey-meshdriver',
			version: 'latest',
		});
		
		await fse.copy(
			path.join(app.path, 'node_modules', 'homey-meshdriver', 'assets', 'driver', 'zwave', 'device.js'),
			path.join(driverPath, 'device.js')
		);
		await fse.remove( 
			path.join(driverPath, 'driver.js')
		);
		
		let sigmaJson = answers.zwaveSigmaDetails;
		let zwJson = {};
		
		// download image
		let imageUrl = sigmaJson.Image || `https://products.z-wavealliance.org/ProductImages/Index?productName=${sigmaJson.CertificationNumber}`;
		if( imageUrl ) {
			let res = await fetch(imageUrl);
			if( res.ok ) {
				await new Promise((resolve, reject) => {
					res.body
						.pipe( fs.createWriteStream( path.join(driverPath, 'assets', 'images', 'original.jpeg')) )
						.on('finish', resolve)
						.on('error', resolve)
				})
			}
		}
		
		// set properties
		zwJson.manufacturerId = parseInt( sigmaJson.ManufacturerId );
		zwJson.productTypeId = [ parseInt( sigmaJson.ProductTypeId ) ];
		zwJson.productId = [ parseInt( sigmaJson.ProductId ) ];
		zwJson.zwaveAllianceProductId = sigmaJson.Id;
		zwJson.zwaveAllianceProductDocumentation = sigmaJson.ManualUrl;
		
		// inclusion & exclusion
		if( sigmaJson.InclusionDescription ) {
			zwJson.learnmode = {
				instruction: {
					en: sigmaJson.InclusionDescription
				}
			}
		}
		
		if( sigmaJson.ExclusionDescription ) {
			zwJson.unlearnmode = {
				instruction: {
					en: sigmaJson.ExclusionDescription
				}
			}
		}
		
		// get associationGroups and associationGroupsOptions if defined
		if( Array.isArray(sigmaJson.AssociationGroups) ) {
			sigmaJson.AssociationGroups.forEach(associationGroup => {
				let associationGroupNumber;
				try {
					associationGroupNumber = parseInt(associationGroup.GroupNumber, 2);
				} catch (err) {
					return;
				}
		
				if( isNaN(associationGroupNumber) ) return;
				
				zwJson.associationGroups = zwJson.associationGroups || [];
				zwJson.associationGroups.push(associationGroupNumber);
		
				if (associationGroup.Description) {
					zwJson.associationGroupsOptions = zwJson.associationGroupsOptions || {};
					zwJson.associationGroupsOptions[associationGroup.GroupNumber] = {
						hint: {
							en: associationGroup.Description,
						},
					};
				}
			});
		}
		
		// parse settings
		if( Array.isArray(sigmaJson.ConfigurationParameters) ) {
			sigmaJson.ConfigurationParameters.forEach(configurationParameter => {

				const settingObj = {};
				settingObj.id = (String)(configurationParameter.ParameterNumber);
				settingObj.value = configurationParameter.DefaultValue;
				settingObj.label = {
					en: (String)(configurationParameter.Name),
				};
				settingObj.hint = {
					en: (String)(configurationParameter.Description),
				};

				settingObj.zwave = {
					index: configurationParameter.ParameterNumber,
					size: configurationParameter.Size
				}

				// guess type
				if (configurationParameter.ConfigurationParameterValues &&
					Array.isArray(configurationParameter.ConfigurationParameterValues) &&
					configurationParameter.ConfigurationParameterValues.length === 2 &&
					(parseInt(configurationParameter.ConfigurationParameterValues[0].From) === 0 || parseInt(configurationParameter.ConfigurationParameterValues[0].From) === 1) &&
					(parseInt(configurationParameter.ConfigurationParameterValues[0].To) === 0 || parseInt(configurationParameter.ConfigurationParameterValues[0].To) === 1) &&
					(parseInt(configurationParameter.ConfigurationParameterValues[0].From) === 0 || parseInt(configurationParameter.ConfigurationParameterValues[0].From) === 1) &&
					(parseInt(configurationParameter.ConfigurationParameterValues[0].To) === 0 || parseInt(configurationParameter.ConfigurationParameterValues[0].To) === 1)
				) {
					settingObj.type = 'checkbox';

					if (settingObj.value === 0) {
						settingObj.value = false;
					} else {
						settingObj.value = true;
					}
				} else if (configurationParameter.ConfigurationParameterValues &&
					Array.isArray(configurationParameter.ConfigurationParameterValues) &&
					configurationParameter.ConfigurationParameterValues.length >= 3) {

					// Probably dropdown
					const dropdownOptions = [];
					configurationParameter.ConfigurationParameterValues.forEach(setting => {
						dropdownOptions.push({
							id: setting.From.toString() || setting.To.toString(),
							label: {
								en: setting.Description,
							},
						});
					});
					settingObj.values = dropdownOptions;
					settingObj.type = 'dropdown';
					settingObj.value = settingObj.value.toString();

				} else {
					settingObj.attr = {};
					if (configurationParameter.ConfigurationParameterValues[0].hasOwnProperty('From'))
						settingObj.attr.min = parseInt(configurationParameter.ConfigurationParameterValues[0].From);
						
					if (configurationParameter.ConfigurationParameterValues[0].hasOwnProperty('To'))
						settingObj.attr.max = parseInt(configurationParameter.ConfigurationParameterValues[0].To);

					// Determine if values are signed or not: https://msdn.microsoft.com/en-us/library/s3f49ktz.aspx
					// size is one, and max is larger than 127 -> unsigned
					if ((configurationParameter.Size === 1 && settingObj.attr.max > 127 && settingObj.attr.max < 255) ||
						(configurationParameter.Size === 2 && settingObj.attr.max > 32767 && settingObj.attr.max < 65535) ||
						(configurationParameter.Size === 4 && settingObj.attr.max > 2147483647 && settingObj.attr.max < 4294967295)) {
						settingObj.signed = false;
					}

					settingObj.type = 'number';
				}

				driverJson.settings = driverJson.settings || [];
				driverJson.settings.push(settingObj);
			});
		}
		
		driverJson.zwave = zwJson;
	}
	
	static async getSigmaDetails( sigmaId ) {
		
		let result;
		
		try {
			let res = await fetch(`http://products.z-wavealliance.org/Products/${sigmaId}/JSON`);
			if( !res.ok ) throw new Error();
			
			let json = await res.json();
			
			result = json;
		} catch( err ) {
			throw new Error('Invalid Sigma Product ID')
		}
		
		return result;
		
		
	}
	
}

module.exports = AppPluginZwave;
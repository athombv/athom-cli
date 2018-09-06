'use strict';

const Log = require('../../..').Log;
const AthomApi = require('../../..').AthomApi;
const Table = require('cli-table');
const colors = require('colors');

exports.desc = 'List all Homeys';
exports.handler = async () => {

	try {
		let homeys = await AthomApi.getHomeys();

		let table = new Table({
			head: [
				'ID',
				'Name',
				'Version',
				'API',
				'Language',
				'State',
				'Users',
				'Role',
				'USB',
			].map( title => colors.white.bold(title) ),
		});

		homeys.sort(( a, b ) => {
			return -(a.state || '').localeCompare( (b.state || '') );
		})

		homeys.forEach(homey => {
			table.push([
				homey._id,
				homey.name,
				homey.softwareVersion,
				homey.apiVersion,
				homey.language,
				AthomApi.getFormattedState( homey ),
				homey.users && homey.users.length,
				homey.role,
				homey.usb ? 'Yes' : '-',
			].map( value => value || '-' ))
		})

		Log(table.toString());
	} catch( err ) {
		Log(err);
	}

}
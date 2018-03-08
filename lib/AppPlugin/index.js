'use strict';

const fs = require('fs');
const path = require('path');
const util = require('util');

const Log = require('../..').Log;
const colors = require('colors');

const readFileAsync = util.promisify( fs.readFile );
const readdirAsync = util.promisify( fs.readdir );

class AppPlugin {
	
	constructor( app, options = {}) {
		this._app = app;
		this._options = options;
	}
	
	async run() {
		throw new Error(`Not implemented, ${this.constructor.name} should extend the run() method`);
	}
	
	log(...args) {
		Log(
			colors.grey(`[${this.constructor.name}]`),
			...args
		);
	}
	
	async _getFiles( filesPath ) {
		try {
			return await readdirAsync( filesPath );
		} catch( err ) {
			return [];
		}
	}
	
	async _getJsonFiles( filesPath ) {
		let result = {};
		let files = await this._getFiles( filesPath );
		for( let i = 0; i < files.length; i++ ) {
			let filePath = files[i];
			if( path.extname(filePath) !== '.json' ) continue;
						
			let fileJson = await this._getJsonFile( path.join( filesPath, filePath ) );
			let fileId = path.basename( filePath, '.json' );
			
			result[ fileId ] = fileJson;
				
		}
		return result;
	}
	
	async _getJsonFile( filePath ) {
		let fileJson = await readFileAsync( filePath );				
		try {
			fileJson = JSON.parse(fileJson);
		} catch( err ) {
			throw new Error(`Error in file ${filePath}\n${err.message}`);
		}
		
		return fileJson;
	}
	
}

module.exports = AppPlugin;
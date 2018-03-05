'use strict';

const Log = require('../..').Log;
const colors = require('colors');

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
	
}

module.exports = AppPlugin;
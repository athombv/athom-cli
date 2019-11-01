'use strict';

/*
	 Plugin ID: rf

	 This plugin installs homey-rfdriver.
	 For documentation on how to use homey-rfdriver visit the repository here: https://github.com/athombv/node-homey-rfdriver

	 This plugin depends on the "compose" plugin and will add it to the .homeyplugins file if not present.

	 Enable the plugin by adding `{ "id": "rf" }` to your /.homeyplugins.json array

	 Plugin options:
	 {
	 "version": "latest"
	 }
 */

const fse = require('fs-extra');
const path = require('path');

const AppPlugin = require('../AppPlugin');

class AppPluginRF extends AppPlugin {

	async run() {
		await this._app.installNpmPackage({
			id: 'homey-rfdriver',
			version: this._options.version,
		});
		if (!await this._app._hasPlugin('compose')) {
			await this._app.addPlugin('compose');
			throw new Error(`Compose plugin is required! "compose" is now added to your .homeyCompose file.
Please re-run your command to continue.`);
		}

		let rfdriverComposePath = path.join(this._app.path, 'node_modules', 'homey-rfdriver', '.compose');
		let appComposePath = path.join(this._app.path, '.homeycompose');

		if (!await fse.pathExists(rfdriverComposePath)) {
			throw new Error('Invalid version of homey-rfdriver installed. Make sure you have installed v2.0.0 or higher.');
		}

		await fse.ensureDir(appComposePath);

		await this.copyPairTemplates(rfdriverComposePath, appComposePath);
		await this.copyDriverTemplates(rfdriverComposePath, appComposePath);
		await this.copyLocales(rfdriverComposePath, appComposePath);

	}

	async copyPairTemplates(rfdriverComposePath, appComposePath) {
		let appComposeDriversPairPath = path.join(appComposePath, 'drivers', 'pair');

		await fse.ensureDir(appComposeDriversPairPath);
		const pairTemplatePath = path.join(rfdriverComposePath, 'pair');
		const pairTemplateAssetsPath = path.join(rfdriverComposePath, 'assets');
		const pairTemplates = await this._getFiles(pairTemplatePath);

		await Promise.all(pairTemplates.map(template => {
			if (template.indexOf('.') === 0) return;

			const copyTemplate = async () => {
				const appComposePairTemplatePath = path.join(appComposeDriversPairPath, `rf.${template}`);
				await fse.ensureDir(appComposePairTemplatePath);
				await fse.copy(path.join(pairTemplatePath, template), appComposePairTemplatePath);

				const pairTemplateAssetsJsonPath = path.join(pairTemplatePath, template, 'assets/assets.json');
				if (!await fse.pathExists(pairTemplateAssetsJsonPath)) return;

				const assets = await fse.readJSON(pairTemplateAssetsJsonPath);
				if (!Array.isArray(assets)) {
					this.log(`Error, assets.json is not an array for template "${template}"!`);
					return;
				}

				return Promise.all(assets.map(async (assetPath) => {
					const templateAssetPath = path.join(pairTemplateAssetsPath, assetPath);
					if (!await fse.pathExists(templateAssetPath)) return this.log(`Error, skipping asset ${assetPath}. File not found!`);

					const appComposeTemplateAssetDirPath = path.join(appComposePairTemplatePath, 'assets', path.dirname(assetPath));
					await fse.ensureDir(appComposeTemplateAssetDirPath);
					return fse.copy(templateAssetPath, path.join(appComposeTemplateAssetDirPath, path.basename(assetPath)));
				}));
			};

			return copyTemplate()
				.catch(err => this.log(`Failed to copy RF template "${template}"`));
		}));

		this.log('Copied RFDriver Pair Templates');
	}

	async copyDriverTemplates(rfdriverComposePath, appComposePath) {
		let appComposeDriversTemplatesPath = path.join(appComposePath, 'drivers', 'templates');
		const templatesPath = path.join(rfdriverComposePath, 'templates');

		if (!await fse.pathExists(templatesPath)) return;

		await fse.ensureDir(appComposeDriversTemplatesPath);
		const templates = this.extendTemplates(await this._getJsonFiles(templatesPath));

		await Promise.all(Object.keys(templates).map((templateId) => {
			const template = templates[templateId];
			if (template.$ignore) return;

			const templateFileName = `rf.${templateId}.json`;

			return fse.writeJSON(path.join(appComposeDriversTemplatesPath, templateFileName), template, { spaces: 2 })
				.catch(err => this.log(`Failed to copy locales file for locale "${templateFileName}"`));
		}));

		this.log('Copied RFDriver Driver Templates');
	}

	extendTemplates(templates) {
		return Object.keys(templates)
			.reduce((result, templateId) => {
				if (result.hasOwnProperty(templateId)) return result;

				const getExtends = (extendIds) => {
					if (!extendIds) return {};

					return [].concat(extendIds).reduce((extend, extendId) => {
						if (!extendId) return extend;

						if (result.hasOwnProperty(extendId)) {
							return {
								...extend,
								...result[extendId],
								$ignore: undefined,
							}
						} else if (templates.hasOwnProperty(extendId)) {
							return {
								...extend,
								...getExtends(templates[extendId]['$extends']),
								...templates[extendId],
								$ignore: undefined,
							}
						}
						throw new Error(`Template with id ${extendId} not found!`);
					}, {});
				};

				const template = templates[templateId];
				result[templateId] = {
					...getExtends(template.$extends),
					...template,
					$extends: undefined,
				};

				return result;
			}, {});
	}

	async copyLocales(rfdriverComposePath, appComposePath) {
		let appComposeLocalesPath = path.join(appComposePath, 'locales');
		const localesPath = path.join(rfdriverComposePath, 'locales');

		if (!await fse.pathExists(localesPath)) return;

		await fse.ensureDir(appComposeLocalesPath);
		const locales = await this._getJsonFiles(localesPath);

		await Promise.all(Object.keys(locales).map((locale) => {
			const [lang, ...subpath] = locale.split('.');
			const localeFileName = [lang, 'rf', ...subpath, 'json'].join('.');

			return fse.writeJSON(path.join(appComposeLocalesPath, localeFileName), locales[locale], { spaces: 2 })
				.catch(err => this.log(`Failed to copy locales file for locale "${localeFileName}"`));
		}));

		this.log('Copied RFDriver Locales');
	}

	static createDriverQuestions() {
		return [
			{
				type: 'confirm',
				name: 'isRf',
				default: false,
				message: 'Is this a RF device (Infrared, 433 MHz or 868 MHz)?',
				when: answers => !answers.isZwave && !answers.isZigbee,
			}
		]
	}

	static async createDriver({ app, driverPath, answers, driverJson }) {

		await app.addPlugin('rf');
		await app.addPlugin('compose');
		await app.installNpmPackage({
			id: 'homey-rfdriver',
			version: 'latest',
		});
		const driverId = answers.id ? answers.id.charAt(0).toUpperCase() + answers.id.slice(1) : 'My';

		const copyDeviceFile = async (filePath, targetPath) => {
			let file = await fse.readFile(filePath, { encoding: 'utf8' });

			file = file.replace(/\/\*<DRIVER_ID>\*\//g, driverId);

			return fse.writeFile(targetPath, file);
		};

		await copyDeviceFile(
			path.join(app.path, 'node_modules', 'homey-rfdriver', '.compose', 'driver', 'driver.js'),
			path.join(driverPath, 'driver.js')
		);
		await copyDeviceFile(
			path.join(app.path, 'node_modules', 'homey-rfdriver', '.compose', 'driver', 'device.js'),
			path.join(driverPath, 'device.js')
		);
	}

}

module.exports = AppPluginRF;
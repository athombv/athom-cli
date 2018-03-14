'use strict';

/*
 Plugin ID: rf

 This plugin installs homey-rfdriver.

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
        // TODO reenable
        // await app.installNpmPackage({
        //     id: 'homey-rfdriver',
        //     version: this._options.version,
        // });

        let rfdriverPath = path.join(this._app.path, 'node_modules', 'homey-rfdriver');
        let appComposePath = path.join(this._app.path, '.homeycompose');

        await this.copyPairTemplates(rfdriverPath, appComposePath);
        await this.copyDriverTemplates(rfdriverPath, appComposePath);
        await this.copyLocales(rfdriverPath, appComposePath);

    }

    async copyPairTemplates(rfdriverPath, appComposePath) {
        let appComposeDriversPairPath = path.join(appComposePath, 'drivers', 'pair');

        await fse.ensureDir(appComposeDriversPairPath);
        const pairTemplatePath = path.join(rfdriverPath, 'compose', 'pair');
        const pairTemplateAssetsPath = path.join(rfdriverPath, 'compose', 'assets');
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
                    if (!await fse.pathExists(templateAssetPath)) return;

                    const appComposeTemplateAssetDirPath = path.join(appComposePairTemplatePath, 'assets', path.dirname(assetPath));
                    await fse.ensureDir(appComposeTemplateAssetDirPath);
                    return fse.copy(templateAssetPath, path.join(appComposeTemplateAssetDirPath, path.basename(assetPath)));
                }));
            };

            return copyTemplate()
                .catch(err => this.log(`Failed to copy RF template "${template}"`));
        }));

        this.log('Copied RF Driver Pair Templates');
    }

    async copyDriverTemplates(rfdriverPath, appComposePath) {
        let appComposeDriversTemplatesPath = path.join(appComposePath, 'drivers', 'templates');
        const templatesPath = path.join(rfdriverPath, 'compose', 'templates');

        if (!await fse.pathExists(templatesPath)) return;

        await fse.ensureDir(appComposeDriversTemplatesPath);
        const templates = await this._getJsonFiles(templatesPath);

        await Promise.all(Object.keys(templates).map((template) => {
            const templateFileName = `rf.${template}`;

            return fse.writeJSON(path.join(appComposeDriversTemplatesPath, templateFileName), templates[template], { spaces: 4 })
                .catch(err => this.log(`Failed to copy locales file for locale "${templateFileName}"`));
        }));

        this.log('Copied RF Driver Templates');
    }

    async copyLocales(rfdriverPath, appComposePath) {
        let appComposeLocalesPath = path.join(appComposePath, 'locales');
        const localesPath = path.join(rfdriverPath, 'compose', 'locales');

        if (!await fse.pathExists(localesPath)) return;

        await fse.ensureDir(appComposeLocalesPath);
        const locales = await this._getJsonFiles(localesPath);

        await Promise.all(Object.keys(locales).map((locale) => {
            const [lang, ...subpath] = locale.split('.');
            const localeFileName = [lang, 'rf', ...subpath, 'json'].join('.');

            return fse.writeJSON(path.join(appComposeLocalesPath, localeFileName), locales[locale], { spaces: 4 })
                .catch(err => this.log(`Failed to copy locales file for locale "${localeFileName}"`));
        }));

        this.log('Copied RF Driver Locales');
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
        // await app.installNpmPackage({
        //     id: 'homey-rfdriver',
        //     version: 'latest',
        // });

        await fse.copy(
            path.join(app.path, 'node_modules', 'homey-rfdriver', 'compose', 'driver'),
            path.join(driverPath)
        );

        // TODO generate driver.compose.json
    }

}

module.exports = AppPluginRF;
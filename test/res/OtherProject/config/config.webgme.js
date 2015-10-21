// DO NOT EDIT THIS FILE
// This file is automatically generated from the webgme-setup-tool.
'use strict';


var config = require('webgme/config/config.default'),
    validateConfig = require('webgme/config/validator');


// The paths can be loaded from the webgme-setup.json
config.plugin.basePaths.push('src/plugin');
config.addOn.basePaths.push('src/addons');
config.visualization.decoratorPaths.push('src/decorators');
config.seedProjects.basePaths.push('src/seed/OtherSeed');

config.addOn.enable = true
// Visualizer descriptors
config.visualization.visualizerDescriptors.push('./src/visualizers/Visualizers.json');
// Add requirejs paths
config.requirejsPaths = {
  'panels': './src/visualizers/panels',
  'widgets': './src/visualizers/widgets'
};

config.mongo.uri = 'mongodb://127.0.0.1:27017/otherproject'
validateConfig(config);
module.exports = config;

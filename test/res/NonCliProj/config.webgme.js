// DO NOT EDIT THIS FILE
// This file is automatically generated from the webgme-cli tool.
'use strict';

var config = require('webgme/config/config.default'),
    validateConfig = require('webgme/config/validator');

// FIXME: This needs to be restructured...
// The paths can be loaded from the .webgme.json
//
// The extra settings (such as enabling executors) need to be
// figured out

// This is a hack :/

config.addOn.enable = true
config.addOn.basePaths.push("addOn/MockAddOn");


validateConfig(config);
module.exports = config;

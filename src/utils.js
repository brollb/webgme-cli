/*globals define*/
'use strict';

const childProcess = require('child_process');
const spawn = childProcess.exec;
const Logger = require('./Logger');
const logger = new Logger();
const PROJECT_CONFIG = 'webgme-setup.json';

var _ = require('lodash'),
    fs = require('fs'),
    path = require('path'),
    exists = require('exists-file'),
    assert = require('assert');

var getRootPath = function(startPath) {
    // Walk back from current path until you find a webgme-setup.json file
    var abspath = path.resolve(startPath || '.'),
        previousPath;

    while (abspath !== previousPath) {
        if (isProjectRoot(abspath)) {
            return abspath;
        }
        previousPath = abspath;
        abspath = path.dirname(abspath);
    }
    return null;
};

var isProjectRoot = function(abspath) {
    // Check for webgme-setup.json file
    if (!exists(abspath)) {
        return null;
    }

    var files = fs.readdirSync(abspath);
    return files.filter(function(file) {
        return file === PROJECT_CONFIG;
    }).length > 0;
};

var changeToRootDir = function(startPath) {
    // Check for project directory
    var rootPath = getRootPath(startPath);

    if (rootPath === null) {
        var err = 'Could not find a project in current or any parent directories';
        throw new Error(err);
    }

    process.chdir(rootPath);
};

/**
 * Save file and create directories as needed.
 *
 * @param {File} file
 * @return {undefined}
 */
var saveFile = function(file) {
    var dir = path.dirname(file.name);

    createDir(dir);
    fs.writeFileSync(file.name, file.content);
};

/**
 * Create directory as needed.
 *
 * @param {String} dir
 * @return {undefined}
 */
var createDir = function(dir) {
    var dirs = path.resolve(dir).split(path.sep),
        shortDir,
        i = 1;

    while (i++ < dirs.length) {
        shortDir = dirs.slice(0,i).join(path.sep);
        if (!exists(shortDir)) {
            fs.mkdirSync(shortDir);
        }
    }
};

var saveFilesFromBlobClient = function(blobClient) {
    var artifactNames = Object.keys(blobClient.artifacts);
    for (var i = artifactNames.length; i--;) {
        blobClient.artifacts[artifactNames[i]].files.forEach(saveFile);
    }
};

/* * * * * * * Config Settings * * * * * * * */
var getConfig = function(startPath) {
    var root = getRootPath(startPath),
        config;

    if (!root) {
        return null;
    }

    config = fs.readFileSync(path.join(root, PROJECT_CONFIG));
    return JSON.parse(config);
};

var saveConfig = function(config) {
    var root = getRootPath();
    var configText = JSON.stringify(config, null, 2);
    fs.writeFileSync(path.join(root, PROJECT_CONFIG), configText);
};

var getAppName = function(startPath) {
    const root = getRootPath(startPath);
    return require(path.join(root, 'package.json')).name;
};

var getPackageJSON = function(startPath) {
    var root = getRootPath(startPath);

    return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
};

var writePackageJSON = function(content, startPath) {
    var root = getRootPath(startPath);

    return fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(content, null, 2));
};

/**
 * Update the WebGME config based on the paths in the webgme-setup.json.
 *
 * @return {undefined}
 */
var updateWebGMEConfig = function(startPath) {
    var root = getRootPath(startPath),
        content = getWebGMEConfigContent(startPath),
        templatePath = path.join(__dirname, 'res', 'config.template.js.ejs'),
        template = _.template(fs.readFileSync(templatePath)),
        configPath = path.join(root, 'config', 'config.webgme.js');

    // Add webgme app name to the content
    var appName = require(path.join(root, 'package.json')).name;
    content.appName = appName.replace(/-/g, '_');

    // Add default layout info
    var config = getConfig(startPath);
    if (config) {
        Object.keys(config).forEach(type => {
            Object.keys(config[type].layouts || {}).forEach(layout => {
                if (config[type].layouts[layout].enabled) {
                    content.defaultLayout = layout;
                }
            });
        });
    }

    // Add router info
    content.routers = [];
    Object.keys(config).forEach(type => {
        Object.keys(config[type].routers || {}).forEach(name => {
            let router = config[type].routers[name];
            router.name = name;
            router.srcFile = `${router.src || router.path}/${name}.js`;
            content.routers.push(router);
        });
    });

    // Create the WebGME config file
    fs.writeFileSync(configPath, template(content));
};

/**
 * Get the paths from a config (sub) object such as "components" or
 * "dependencies"
 *
 * Input example: {
 *   plugins: {
 *      ...
 *   },
 *   seeds: {
 *      ...
 *   }
 * }
 *
 * @param {Object} config
 * @return {String[]}
 */
var getPathsFromConfigGroup = function(config) {
    return Object.values(config).map(componentType =>  // ie, plugin/seed/etc OBJECT
        Object.values(componentType)
            .map(component => component.src || component.path)
    );
};

var unique = function(array) {
    var duplicates = {};
    array.forEach(function(key) {
        duplicates[key] = 1;
    });
    return Object.keys(duplicates);
};

var getWebGMEConfigContent = function(startPath) {
    var config = getConfig(startPath),
        paths = {},
        categories = ['components', 'dependencies'],
        configGroupPaths = categories
            .map(function(type) {
                return getPathsFromConfigGroup(config[type]);
            }
        );

    // Merge the arrays for each componentType
    Object.keys(configGroupPaths[0]).forEach(function(type) {
        const configPaths = _.flatMap(
            configGroupPaths,
            group => unique(group[type])
        );

        paths[type] = configPaths.map(p => p.replace(/\\/g, '/'));  // Convert to use '/' for path separator
    });

    // Update visualizers to use the 'panel' entry (if applicable)
    if (config.components.visualizers) {
        // add the components
        let local = Object.keys(config.components.visualizers)
            .map(name => config.components.visualizers[name].panel);

        // and the dependencies
        paths.visualizers = Object.keys(config.dependencies.visualizers)
            .map(name => [
                'node_modules',
                config.dependencies.visualizers[name].project,
                config.dependencies.visualizers[name].panel].join('/'))
            .concat(local);

    }


    // Set the requirejsPaths to be an array of all dependency paths
    paths.requirejsPaths = getRequireJSPaths(config, startPath);
    return paths;
};

var getRequireJSPaths = function(config, startPath) {
    var componentTypes = Object.keys(config.dependencies),
        components,
        paths = [],
        names,
        i;

    for (i = componentTypes.length; i--;) {
        components = config.dependencies[componentTypes[i]];
        names = Object.keys(components);
        for (var j = names.length; j--;) {
            paths.push({
                name: names[j],
                path: components[names[j]].src || components[names[j]].path
            });
        }
    }

    // If it has any visualizers, add some boilerplate
    if (hasVisualizers(config)) {
        ['panels', 'widgets'].forEach(function(name) {
            paths.push({
                name: name,
                path: './src/visualizers/'+name
            });
        });

        // Add all dependent visualizers
        // These are in the format 'widgets/DepViz': './node_modules/<project>/<path>'
        var vizConfig = config.dependencies.visualizers,
            dependentVizs = Object.keys(vizConfig),
            depName,
            depPath,
            project;

        for (i = dependentVizs.length; i--;) {
            depName = vizConfig[dependentVizs[i]].src.split('/');
            depName.pop();
            depName = depName.join('/');

            project = vizConfig[dependentVizs[i]].project.toLowerCase();
            depPath = ['.', 'node_modules', project,
                vizConfig[dependentVizs[i]].panel].join('/');

            paths.push({
                name: depName,
                path: depPath
            });

            depPath = ['.', 'node_modules', project,
                vizConfig[dependentVizs[i]].widget].join('/');

            paths.push({
                name: depName.replace('panel', 'widget'),
                path: depPath
            });
        }
    }

    // Add common directories for all the dependent projects (and ourself)
    let allProjects = componentTypes.map(type => {
        let names = Object.keys(config.dependencies[type]);
        return names.map(name => config.dependencies[type][name].project);
    }).reduce((l1, l2) => l1.concat(l2), []);
    let projects = _.uniq(allProjects);
    projects.forEach(project => {
        project = project.toLowerCase();
        paths.push({
            name: project,
            path: `./node_modules/${project}/src/common`
        });
    });
    paths.push({
        name: getAppName(startPath),
        path: './src/common'
    });

    return paths;
};

/**
 * Check that the config contains at least one visualizer (in either components
 * or dependencies)
 *
 * @param config
 * @return {Boolean}
 */
var hasVisualizers = function(config) {
    return ['components', 'dependencies']
        .reduce(function(prev, type) {
            return prev || (config[type].visualizers &&
                Object.keys(config[type].visualizers).length > 0);
        }, false);
};

var getConfigPath = function(project) {
    return path.join(getRootPath(), 'node_modules',
        project, PROJECT_CONFIG);
};

/**
 * Get the GME path for the given dependent project or the working project
 * if unspecified
 *
 * @param {String} project
 * @return {String} path
 */
var getGMEConfigPath = function(project) {
    var gmeConfigPath,
        projectPath = '';

    if (project) {
        projectPath = path.join('node_modules', project);
    }
    gmeConfigPath = path.join(getRootPath(), projectPath, 'config');

    return gmeConfigPath;
};

/**
 * Find the first path containing the given item.
 *
 * @param {String[]} pathType
 * @param {String} item
 * @return {String} path containing the item
 */
var getPathContaining = function(paths, item) {
    var validPaths = paths.filter(function(p) {
        return exists(p) && fs.readdirSync(p).indexOf(item) +
            fs.readdirSync(p).indexOf(item+'.js') !== -2;
    });
    return validPaths.length ? validPaths[0] : null;
};

/**
 * Get the name of the package installed with "npmPackage"
 *
 * @param {String} npmPackage
 * @return {String} name
 */
var getPackageName = function(npmPackage) {
    // FIXME: It currently assumes everything is a github url. Should support
    // hashes, packages, etc
    // Ideally, we could use an npm feature to do this
    if (npmPackage[0] === '.') {  // File path
        return npmPackage.split(path.sep).pop();
    }

    // Github url: project/repo
    return npmPackage.split('/').pop().replace(/#.*$/, '');
};

var loadPaths = function(requirejs) {
    const webgmeEngineRoot = path.dirname(require.resolve('webgme-engine'));
    requirejs.config({
        nodeRequire: require,
        baseUrl: __dirname,
        paths: {
            text: `${webgmeEngineRoot}/src/common/lib/requirejs/text`,
            coreplugins: `${webgmeEngineRoot}/src/plugin/coreplugins`,
            plugin: `${webgmeEngineRoot}/src/plugin`,
            common: `${webgmeEngineRoot}/src/common`,

            'plugin/PluginGenerator/PluginGenerator': `${webgmeEngineRoot}/src/plugin/coreplugins/PluginGenerator/`,
            'plugin/AddOnGenerator/AddOnGenerator': `${webgmeEngineRoot}/src/plugin/coreplugins/AddOnGenerator/`,
            'plugin/DecoratorGenerator/DecoratorGenerator': `${webgmeEngineRoot}/src/plugin/coreplugins/DecoratorGenerator/`,
            'plugin/LayoutGenerator/LayoutGenerator': `${webgmeEngineRoot}/src/plugin/coreplugins/LayoutGenerator/`,
            'plugin/VisualizerGenerator/VisualizerGenerator': `${webgmeEngineRoot}/src/plugin/coreplugins/VisualizerGenerator/`
        }
    });
};

var normalizePath = function(dirs) {
    if (path.sep === '\\') {
        return dirs.replace(/\\/g, '/');
    }
    return dirs;
};

const installProject = function(projectName, isDev, callback) {
    let projectRoot = getRootPath();
    let cmd = isDev ?
        `npm install ${projectName} --save-dev`:
        `npm install ${projectName} --save`;
    let job = spawn(cmd, {cwd: projectRoot});

    logger.info(cmd);
    logger.writeStream(job.stdout);
    logger.errorStream(job.stderr);

    job.on('close', code => {
        logger.info(`npm exited with: ${code}`);
        if (code === 0) {  // Success!
            return callback(null);
        } else {
            let err = `Could not find project (${projectName})!`;
            logger.error(err);
            return callback(err);
        }
    });
};



module.exports = {
    PROJECT_CONFIG: PROJECT_CONFIG,
    saveConfig: saveConfig,
    getConfig: getConfig,
    getRootPath: getRootPath,
    getGMEConfigPath: getGMEConfigPath,
    getPathContaining: getPathContaining,
    getConfigPath: getConfigPath,
    updateWebGMEConfig: updateWebGMEConfig,
    saveFilesFromBlobClient: saveFilesFromBlobClient,
    saveFile: saveFile,
    loadPaths: loadPaths,
    getPackageName: getPackageName,
    normalize: normalizePath,
    installProject: installProject,
    mkdir: createDir,
    getPackageJSON: getPackageJSON,
    writePackageJSON: writePackageJSON,
    changeToRootDir: changeToRootDir,
};

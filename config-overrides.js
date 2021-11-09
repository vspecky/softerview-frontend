const MonacoEditorPlugin = require("monaco-editor-webpack-plugin");

module.exports = (config, _) => {
    if (!config.plugins) {
        config.plugins = [];
    }

    config.plugins.push(new MonacoEditorPlugin());

    return config;
}

import { DefinePlugin, type Configuration } from "webpack";

import { VueLoaderPlugin } from "vue-loader";

import { rules } from "./webpack.rules";
import { plugins } from "./webpack.plugins";

import { GitRevisionPlugin } from "git-revision-webpack-plugin";

const gitRevisionPlugin = new GitRevisionPlugin();

rules.push({
  test: /\.css$/,
  use: [{ loader: "style-loader" }, { loader: "css-loader" }]
});
rules.push({
  test: /\.vue$/,
  loader: "vue-loader"
});
rules.push({
  test: /\.png$/,
  type: "asset/resource"
});
rules.push({
  test: /\.ttf$/,
  type: "asset/resource"
});

export const rendererConfig: Configuration = {
  module: {
    rules
  },
  plugins: [
    gitRevisionPlugin,
    new DefinePlugin({
      YTMD_GIT_VERSION: JSON.stringify(gitRevisionPlugin.version()),
      YTMD_GIT_COMMIT_HASH: JSON.stringify(gitRevisionPlugin.commithash()),
      YTMD_GIT_BRANCH: JSON.stringify(gitRevisionPlugin.branch()),
      YTMD_GIT_LAST_COMMIT_DATE_TIME: JSON.stringify(gitRevisionPlugin.lastcommitdatetime())
    }),
    new VueLoaderPlugin(),
    ...plugins
  ],
  resolve: {
    extensions: [".js", ".ts", ".jsx", ".tsx", ".css"]
  }
};

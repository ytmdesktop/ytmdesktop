import { DefinePlugin, type Configuration } from "webpack";

import { VueLoaderPlugin } from "vue-loader";

import { rules } from "./webpack.rules";
import { plugins } from "./webpack.plugins";

import ChildProcess from 'child_process';

const gitBranch = ChildProcess.execSync("git rev-parse --abbrev-ref HEAD").toString();
const gitCommitHash = ChildProcess.execSync("git rev-parse HEAD").toString();

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
    new DefinePlugin({
      YTMD_GIT_COMMIT_HASH: JSON.stringify(gitCommitHash),
      YTMD_GIT_BRANCH: JSON.stringify(gitBranch)
    }),
    new VueLoaderPlugin(),
    ...plugins
  ],
  resolve: {
    extensions: [".js", ".ts", ".jsx", ".tsx", ".css"]
  }
};

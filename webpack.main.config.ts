import { DefinePlugin, type Configuration } from "webpack";

import path from "path";

import { rules } from "./webpack.rules";

rules.push({
  test: /\.tsx?$/,
  exclude: /(node_modules|\.webpack)/,
  use: {
    loader: "ts-loader",
    options: {
      transpileOnly: true,
      configFile: path.join(__dirname, "src/main/tsconfig.json")
    }
  }
});

export const mainConfig: Configuration = {
  /**
   * This is the main entry point for your application, it's the first file
   * that runs in the main process.
   */
  entry: "./src/main/index.ts",
  // Put your normal webpack config below here
  module: {
    rules
  },
  plugins: [
    new DefinePlugin({
      YTMD_DISABLE_UPDATES: false,
      YTMD_UPDATE_FEED_OWNER: `'${process.env.YTMD_UPDATE_FEED_OWNER}'` ?? "'ytmdesktop'",
      YTMD_UPDATE_FEED_REPOSITORY: `'${process.env.YTMD_UPDATE_FEED_REPOSITORY}'` ?? "'ytmdesktop'"
    })
  ],
  resolve: {
    alias: {
      "~shared": path.resolve(__dirname, "src/shared"),
      "~assets": path.resolve(__dirname, "src/assets")
    },
    extensions: [".js", ".ts", ".jsx", ".tsx", ".css", ".json"]
  },
  devtool: process.env.NODE_ENV === "development" ? "eval-source-map" : false
};

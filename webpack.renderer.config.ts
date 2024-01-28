import { DefinePlugin, type Configuration } from "webpack";

import { VueLoaderPlugin } from "vue-loader";
import ChildProcess from "child_process";
import path from "path";

import { rules } from "./webpack.rules";
import { plugins } from "./webpack.plugins";

let gitBranch: string = "";
let gitCommitHash: string = "";
try {
  gitBranch = ChildProcess.execSync("git rev-parse --abbrev-ref HEAD").toString();
  gitCommitHash = ChildProcess.execSync("git rev-parse HEAD").toString();
} catch (e) {
  // User has likely downloaded from the YTM Desktop via the "Download ZIP".
  // We don't plan to support this, but at least provide users with a bit of improved UX
  // by providing them with what to do rather than just leaving them in the dust.

  e.message =
    " ======= Failed to get Git Info. ======= \n" +
    "Please make sure that when building this application you are cloning the repository from GitHub rather than using the Download ZIP option.\n" +
    "Follow the instructions in the README.md file to clone the repository and build the application from there.\n" +
    " ======= Failed to get Git Info. ======= \n\n" +
    e.message;

  // Re-throw the error so that the build fails with the updated message.
  throw e;
}

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
rules.push({
  test: /\.tsx?$/,
  exclude: /(node_modules|\.webpack)/,
  use: {
    loader: "ts-loader",
    options: {
      transpileOnly: true,
      configFile: path.join(__dirname, "src/renderer/tsconfig.json"),
      appendTsSuffixTo: [/\.vue$/]
    }
  }
});

export const rendererConfig: Configuration = {
  module: {
    rules
  },
  optimization: {
    splitChunks: {
      cacheGroups: {
        shared: {
          name: "shared",
          test: /[\\/]src[\\/]shared[\\/]/,
          chunks: "all"
        },
        vueSharedComponents: {
          name: "vue_shared_components",
          test: /[\\/]src[\\/]renderer[\\/]components[\\/]/,
          chunks: "all"
        },
        vendorVue: {
          name: "vendor_vue",
          test: /[\\/]node_modules[\\/]@?vue.*?[\\/]/,
          chunks: "all"
        }
      }
    }
  },
  plugins: [
    new DefinePlugin({
      YTMD_GIT_COMMIT_HASH: JSON.stringify(gitCommitHash),
      YTMD_GIT_BRANCH: JSON.stringify(gitBranch),
      __VUE_OPTIONS_API__: false,
      __VUE_PROD_DEVTOOLS__: false
    }),
    new VueLoaderPlugin(),
    ...plugins
  ],
  resolve: {
    alias: {
      "~shared": path.resolve(__dirname, "src/shared"),
      "~assets": path.resolve(__dirname, "src/assets")
    },
    extensions: [".js", ".ts", ".jsx", ".tsx", ".css"]
  },
  devtool: process.env.NODE_ENV === "development" ? "eval-source-map" : false
};

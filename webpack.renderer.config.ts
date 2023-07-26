import type { Configuration } from "webpack";

import { VueLoaderPlugin } from "vue-loader";

import { rules } from "./webpack.rules";
import { plugins } from "./webpack.plugins";

rules.push({
  test: /\.css$/,
  use: [{ loader: "style-loader" }, { loader: "css-loader" }]
});
rules.push({
  test: /\.vue$/,
  loader: "vue-loader"
});

export const rendererConfig: Configuration = {
  module: {
    rules
  },
  plugins: [new VueLoaderPlugin(), ...plugins],
  resolve: {
    extensions: [".js", ".ts", ".jsx", ".tsx", ".css"]
  }
};

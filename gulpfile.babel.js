/*
 * Copyright 2016 Google Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const gulp = require('gulp');
const $ = require('gulp-load-plugins')();
const del = require('del');
const runSequence = require('run-sequence');
const browserSync = require('browser-sync');
const reload = browserSync.reload;
const merge = require('merge-stream');
const swig = require('swig');
const swigExtras = require('swig-extras');
const through = require('through2');
const path = require('path');
const workboxBuild = require('workbox-build');
const prettyBytes = require('pretty-bytes');
const webpack = require('webpack');

const AUTOPREFIXER_BROWSERS = [
  'ie >= 10',
  'ie_mob >= 10',
  'ff >= 30',
  'chrome >= 34',
  'safari >= 7',
  'ios >= 7',
  'android >= 4.4'
];


let DEV_MODE = false;
let BASE_HREF = DEV_MODE ? '/' : '/AndroidAssetStudio/';

let webpackInstance;

function printWebpackStats(stats) {
  console.log(stats.toString({
    modules: false,
    colors: true,
  }));
};


function errorHandler(error) {
  console.error(error.stack);
  this.emit('end'); // http://stackoverflow.com/questions/23971388
}

// Lint JavaScript
gulp.task('webpack', cb => {
  // force reload webpack config
  delete require.cache[require.resolve('./webpack.config.js')];
  let webpackConfig = require('./webpack.config.js');
  webpackConfig.mode = DEV_MODE ? 'development' : 'production';
  webpackInstance = webpack(webpackConfig, (err, stats) => {
    printWebpackStats(stats);
    cb();
  });
});

// Optimize Images
gulp.task('res', () => {
  return gulp.src('app/res/**/*')
    .pipe($.cache($.imagemin({
      progressive: true,
      interlaced: true
    })))
    .pipe(gulp.dest('dist/res'));
});

// Copy All Files At The Root Level (app) and lib
gulp.task('copy', () => {
  return merge(
      gulp.src(['app/*', '!app/sw-prod.js'], {dot: true, nodir: true,})
          .pipe(gulp.dest('dist')),
      gulp.src('older-version/**/*', {dot: true})
          .pipe(gulp.dest('dist/older-version')));
});

// Compile and Automatically Prefix Stylesheets
gulp.task('styles', () => {
  // For best performance, don't add Sass partials to `gulp.src`
  return gulp.src('app/styles/app.entry.scss')
    .pipe($.changed('styles', {extension: '.scss'}))
    .pipe($.sassGlob())
    .pipe($.sass({
      style: 'expanded',
      precision: 10,
      quiet: true
    }).on('error', errorHandler))
    .pipe($.autoprefixer(AUTOPREFIXER_BROWSERS))
    // Concatenate And Minify Styles
    .pipe($.if(!DEV_MODE, $.csso()))
    .pipe($.tap((file, t) => {
      file.path = file.path.replace(/\.entry\.css$/, '.css');
    }))
    .pipe(gulp.dest('dist'));
});


gulp.task('html', () => {
  let pages = [];

  return gulp.src([
      'app/html/**/*.html',
      '!app/html/**/_*.html'
    ])
    // Extract frontmatter
    .pipe($.frontMatter({
      property: 'frontMatter',
      remove: true
    }).on('error', errorHandler))
    // Start populating context data for the file, globalData, followed by file's frontmatter
    .pipe($.tap((file, t) => {
      file.contextData = Object.assign({}, file.frontMatter);
    }))
    // Populate the global pages collection
    // Wait for all files first (to collect all front matter)
    .pipe($.util.buffer())
    .pipe(through.obj(function(filesArray, enc, cb) {
      filesArray.forEach(file => {
        let pageInfo = {path: file.path, data: file.frontMatter || {}};
        pages.push(pageInfo);
      });
      // Re-emit each file into the stream
      filesArray.forEach(file => this.push(file));
      cb();
    }))
    .pipe($.tap((file, t) => {
      // Finally, add pages array to collection
      file.contextData = Object.assign(file.contextData, {all_pages: pages});
    }))
    // Run everything through swig templates
    .pipe($.swig({
      data: file => file.contextData,
      defaults: {
        cache: false
      }
    }).on('error', errorHandler))
    // Concatenate And Minify JavaScript
    // Minify Any HTML
    .pipe($.replace(/%%BASE_HREF%%/g, BASE_HREF))
    .pipe(gulp.dest('.tmp'))
    .pipe($.if('*.html', $.minifyHtml()))
    // Output Files
    .pipe(gulp.dest('dist'));
});

// Clean Output Directory
gulp.task('clean', cb => {
  del.sync(['.tmp', 'dist']);
  $.cache.clearAll();
  cb();
});

// Watch Files For Changes & Reload
gulp.task('serve', cb => {
  DEV_MODE = true;
  runSequence('__serve__', cb);
});

gulp.task('__serve__', ['styles', 'html', 'webpack'], () => {
  browserSync({
    notify: false,
    // Run as an https by uncommenting 'https: true'
    // Note: this uses an unsigned certificate which on first access
    //       will present a certificate warning in the browser.
    // https: true,
    server: {
      baseDir: ['.tmp', 'dist', 'app'],
    },
    port: 3000,
  });

  gulp.watch(['app/html/**/*.html'], ['html', reload]);
  gulp.watch(['app/**/*.{scss,css}'], ['styles', reload]);
  gulp.watch(['app/res/**/*'], reload);

  if (webpackInstance) {
    webpackInstance.watch({}, (err, stats) => {
      printWebpackStats(stats);
      reload();
    });
  }
});

// Build and serve the output from the dist build
gulp.task('serve:dist', ['default'], () => {
  browserSync({
    notify: false,
    // Run as an https by uncommenting 'https: true'
    // Note: this uses an unsigned certificate which on first access
    //       will present a certificate warning in the browser.
    // https: true,
    server: 'dist',
    port: 3001,
  });
});

gulp.task('service-worker', () => {
  return workboxBuild.injectManifest({
    swSrc: path.join('app', 'sw-prod.js'),
    swDest: path.join('dist', 'sw.js'),
    globDirectory: 'dist',
    globIgnores: [
      'older-version/**/*',
    ],
    globPatterns: [
      '*.html',
      '**/*.svg',
      '**/*.js',
      '**/*.css',
    ],
  }).then(obj => {
    obj.warnings.forEach(warning => console.warn(warning));
    console.log(`A service worker was generated to precache ${obj.count} files ` +
                `totalling ${prettyBytes(obj.size)}`);
  });
});

// Build Production Files, the Default Task
gulp.task('default', ['clean'], cb => {
  runSequence(
      'styles',
      ['webpack', 'html', 'res', 'copy'],
      'service-worker',
      cb);
});

// Deploy to GitHub pages
gulp.task('deploy', () => {
  return gulp.src('dist/**/*', {dot: true})
      .pipe($.ghPages());
});

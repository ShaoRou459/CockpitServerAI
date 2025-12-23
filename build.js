#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import os from 'node:os';

import { sassPlugin } from 'esbuild-sass-plugin';

const production = process.env.NODE_ENV === 'production';
const useWasm = os.arch() !== 'x64';

const esbuild = (await import(useWasm ? 'esbuild-wasm' : 'esbuild')).default;

const parser = (await import('argparse')).default.ArgumentParser();
parser.add_argument('-w', '--watch', { action: 'store_true', help: "Enable watch mode", default: process.env.ESBUILD_WATCH === "true" });
const args = parser.parse_args();

const outdir = 'dist';
// Include src/lib for cockpit module stubs
const nodePaths = ['src/lib', 'node_modules'];

// Obtain package name from package.json
const packageJson = JSON.parse(fs.readFileSync('package.json'));

// Clean plugin - removes old files from dist
function cleanPlugin() {
    return {
        name: 'clean',
        setup(build) {
            build.onStart(() => {
                if (fs.existsSync(outdir)) {
                    // Only clean on first build, not on watch rebuilds
                    if (!args.watch) {
                        fs.rmSync(outdir, { recursive: true, force: true });
                    }
                }
                fs.mkdirSync(outdir, { recursive: true });
            });
        }
    };
}

// Notify when build finishes
function notifyEndPlugin() {
    return {
        name: 'notify-end',
        setup(build) {
            let startTime;

            build.onStart(() => {
                startTime = new Date();
            });

            build.onEnd(() => {
                const endTime = new Date();
                const timeStamp = endTime.toTimeString().split(' ')[0];
                console.log(`${timeStamp}: Build finished in ${endTime - startTime} ms`);
            });
        }
    };
}

// Watch directories recursively
function watch_dirs(dir, on_change) {
    const callback = (ev, dir, fname) => {
        if (ev !== "change" || fname.startsWith('.')) {
            return;
        }
        on_change(path.join(dir, fname));
    };

    fs.watch(dir, {}, (ev, path) => callback(ev, dir, path));

    const d = fs.opendirSync(dir);
    let dirent;

    while ((dirent = d.readSync()) !== null) {
        if (dirent.isDirectory())
            watch_dirs(path.join(dir, dirent.name), on_change);
    }
    d.closeSync();
}

// Generate empty po.js for localization placeholder
function generatePoJs() {
    const poContent = `// Placeholder for localization
window.cockpit_po = {};
`;
    fs.writeFileSync(path.join(outdir, 'po.js'), poContent);
}

const context = await esbuild.context({
    ...!production ? { sourcemap: "linked" } : {},
    bundle: true,
    entryPoints: ['./src/index.tsx'],
    // Only mark font files and assets as external
    external: [
        '*.woff',
        '*.woff2',
        '*.jpg',
        '*.svg',
        '../../assets*'
    ],
    legalComments: 'external',
    loader: {
        ".js": "jsx",
        ".ts": "ts",
        ".tsx": "tsx",
    },
    metafile: true,
    minify: production,
    nodePaths,
    outdir,
    target: ['es2020'],
    plugins: [
        cleanPlugin(),

        // Copy assets after build
        {
            name: 'copy-assets',
            setup(build) {
                build.onEnd(() => {
                    fs.copyFileSync('./src/manifest.json', './dist/manifest.json');
                    fs.copyFileSync('./src/index.html', './dist/index.html');
                    generatePoJs();
                });
            }
        },

        sassPlugin({
            loadPaths: ['node_modules'],
            quietDeps: true,
        }),

        notifyEndPlugin(),
    ]
});

try {
    const result = await context.rebuild();

    if (!args.watch) {
        fs.writeFileSync('metafile.json', JSON.stringify(result.metafile));
    }
} catch (e) {
    console.error('Build failed:', e);
    if (!args.watch)
        process.exit(1);
}

if (args.watch) {
    const on_change = async path => {
        console.log("change detected:", path);
        await context.cancel();

        try {
            await context.rebuild();
        } catch (e) { } // ignore in watch mode
    };

    watch_dirs('src', on_change);

    console.log('Watching for changes...');
    // wait forever until Control-C
    await new Promise(() => { });
}

context.dispose();

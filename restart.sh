#!/bin/bash
killall node
cd dexBack
nohup node index.js &
cd ../dex
yarn build
nohup serve -s build &
cd ..


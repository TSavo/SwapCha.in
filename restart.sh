#!/bin/bash
killall node
cd dex
nohup node index.js &
cd ..
yarn build
nohup serve -s build &

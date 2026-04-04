#!/usr/bin/env bash
# macOS：双击本文件将关闭所有运行中的本地测试后台服务
cd "$(dirname "$0")"
chmod +x ./stop-test.sh
exec ./stop-test.sh

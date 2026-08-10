# SAM build for CaptureFunction.
#
# BuildMethod: makefile rather than SAM's built-in esbuild builder, for one
# reason: the builtin runs CopySource first, which copies only this directory,
# so the handler's `../../src/core/...` imports do not exist in the sandbox and
# the bundle fails to resolve them. The makefile builder runs in place, so the
# shared parser stays importable from its single source — which is the whole
# point of not writing a second parser.
#
# Tabs, not spaces, in the recipe lines below. make is unforgiving about it.

build-CaptureFunction:
	npx --yes esbuild@0.28.2 src/capture.ts --bundle --platform=node --target=node22 --format=esm --outfile=$(ARTIFACTS_DIR)/capture.mjs --sourcemap --external:@aws-sdk/* --external:pg-native

.PHONY: all build tests update_submodules check_node

all: build test package

# Prefer the Node version pinned in package.json (via the volta "volta" config)
VOLTA := $(shell command -v volta 2>/dev/null)
ifneq ($(strip $(VOLTA)),)
export PATH := $(dir $(VOLTA)):$(PATH)
endif

check_node:
	@node -e 'const m = +process.versions.node.split(".")[0]; \
		if (m !== 24) { \
			console.error("Error: Node 24 is required (found Node " + process.versions.node + ")."); \
			console.error("Install volta (https://volta.sh) and run: volta install node@24"); \
			process.exit(1); \
		}'

VSCE = ./node_modules/@vscode/vsce/vsce

grammar = src/language/r-check.langium
src = $(wildcard src/**/*.ts)
bin = $(wildcard src/**/*.ts)
jar = rcheck-0.1.jar
java_src = $(shell find recipe -type f -name '*.java')

test_files = $(wildcard test/**/*.test.ts)

# Extract version number from package.json
version = $(strip $(shell grep version package.json | tr -s ' ' | cut -d' ' -f3 | cut -c2- | tr -d '",'))

build: check_node out/extension/main.js

out/extension/main.js:  $(src) $(bin) $(grammar) package.json fix-syntax.cjs
	npm install
	npm run langium:generate
	npm run fix-syntax
	npm run build

update_submodules:
	@git submodule update --remote

bin/$(jar): $(java_src)
	cd recipe && mvn package
	cp recipe/target/$(jar) $@

package: check_node rcheck-$(version).vsix

rcheck-$(version).vsix: package.json out/extension/main.js bin/$(jar)
#	The option --allow-package-secrets sendgrid prevents a false positive when scanning for secrets in the compiled javascript
	${VSCE} package --allow-package-secrets sendgrid

# We need to do this little trick since 'test' is an actual directory name
test: tests

tests: build $(test_files)
	npm run test

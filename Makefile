PHONY: all build tests

all: build test package

grammar = src/language/r-check.langium
src = $(wildcard src/**/*.ts)
bin = $(wildcard src/**/*.ts)
jar = rcheck-0.1.jar
test_files = $(wildcard test/**/*.test.ts)

# Extract version number from package.json
version = $(strip $(shell grep version package.json | tr -s ' ' | cut -d' ' -f3 | cut -c2- | rev | cut -c3- | rev))

build: out/extension/main.js

out/extension/main.js:  $(src) $(bin) $(grammar) package.json
	npm run langium:generate
	npm run build


bin/$(jar):
	cd recipe && mvn package
	cp recipe/target/$(jar) $@


package: build bin/$(jar) rcheck-$(version).vsix package.json


rcheck-$(version).vsix:
	vsce package

# We need to do this little trick since 'test' is an actual directory name
test: tests

tests: build $(test_files)
	npm run test

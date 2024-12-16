PHONY: all build tests

all: build test

# TODO wildcard for source files so we only run `build' when there are actual changes

build:
	npm run langium:generate
	npm run build

# We need to do this little trick since 'test' is an actual directory name
test: tests

tests: build
	npm run test
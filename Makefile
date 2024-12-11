PHONY: all tests

all:
	npm run langium:generate
	npm run build

# We need to do this little trick since 'test' is an actual directory name
test: tests

tests:
	npm run test
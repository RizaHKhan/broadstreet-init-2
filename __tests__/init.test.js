const logToConsole = require('../src/init-2')

test('Log something to console', () => {
    let output = logToConsole('Edward')
    expect(output).toBe('Broadstreet Logger: Edward')
})
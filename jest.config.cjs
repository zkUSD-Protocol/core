module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      { useESM: true }
    ]
  },
  extensionsToTreatAsEsm: ['.ts']
};


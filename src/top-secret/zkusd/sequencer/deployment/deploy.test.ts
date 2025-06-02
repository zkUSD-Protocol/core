import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { DeploymentService } from './deploy.js';

describe('ZkUsd Sequencer Deployment Tests', () => {
  before(async () => {});

  it('should deploy the contracts', async () => {
    const deploymentService = new DeploymentService('localnet');
    await deploymentService.deploy();

    console.log(deploymentService.packageId);
    console.log(deploymentService.intentQueueSystemId);
    console.log(deploymentService.validatorRegistryId);

    assert.ok(deploymentService.packageId);
    assert.ok(deploymentService.intentQueueSystemId);
    assert.ok(deploymentService.validatorRegistryId);
  });
});

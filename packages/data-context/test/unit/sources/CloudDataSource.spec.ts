import sinon from 'sinon'
import { execute, parse } from 'graphql'
import chaiAsPromised from 'chai-as-promised'
import { Response } from 'cross-fetch'

import { DataContext } from '../../../src/DataContext'
import { CloudDataResponse, CloudDataSource } from '../../../src/sources'
import { createTestDataContext, scaffoldProject } from '../helper'
import chai, { expect } from 'chai'
import { ExecutionResult } from '@urql/core'

chai.use(chaiAsPromised)

const FAKE_USER_QUERY = parse(`{ cloudViewer { __typename id fullName email } }`)
const FAKE_USER_RESPONSE = { data: { cloudViewer: { __typename: 'CloudUser', id: '1', fullName: 'test', email: 'test@example.com' } } }
const FAKE_USER_WITH_OPTIONAL_MISSING = parse(`{ cloudViewer { __typename id fullName email cloudProfileUrl } }`)
const FAKE_USER_WITH_OPTIONAL_MISSING_RESPONSE = { data: { cloudViewer: { __typename: 'CloudUser', id: '1', fullName: 'test', email: 'test@example.com', cloudProfileUrl: null } } }
const FAKE_USER_WITH_OPTIONAL_RESOLVED_RESPONSE = { data: { cloudViewer: { __typename: 'CloudUser', id: '1', fullName: 'test', email: 'test@example.com', cloudProfileUrl: 'https://example.com' } } }
const FAKE_USER_WITH_REQUIRED_MISSING = parse(`{ cloudViewer { __typename id fullName email userIsViewer } }`)
const FAKE_USER_WITH_REQUIRED_RESOLVED_RESPONSE = { data: { cloudViewer: { __typename: 'CloudUser', id: '1', fullName: 'test', email: 'test@example.com', userIsViewer: true } } }
const CLOUD_PROJECT_QUERY = parse(`{ currentProject { 
  id 
  cloudProject { __typename  ... on CloudProject { id } }
} }`)
const CLOUD_PROJECT_RESPONSE = { data: { cloudProjectBySlug: { __typename: 'CloudProject', id: '1' } } }

describe('CloudDataSource', () => {
  let cloudDataSource: CloudDataSource
  let fetchStub: sinon.SinonStub
  let getUserStub: sinon.SinonStub
  let ctx: DataContext

  beforeEach(() => {
    sinon.restore()
    fetchStub = sinon.stub()
    fetchStub.resolves(new Response(JSON.stringify(FAKE_USER_RESPONSE), { status: 200 }))
    getUserStub = sinon.stub()
    getUserStub.returns({ authToken: '1234' })
    ctx = createTestDataContext('open')
    cloudDataSource = new CloudDataSource({
      fetch: fetchStub,
      getUser: getUserStub,
    })
  })

  describe('excecuteRemoteGraphQL', () => {
    it('returns immediately with { data: null } when no user is defined', () => {
      getUserStub.returns(null)
      const result = cloudDataSource.executeRemoteGraphQL({
        document: FAKE_USER_QUERY,
        variables: {},
        operationType: 'query',
      })

      expect(result).to.eql({ data: null })
      expect(fetchStub).not.to.be.called
    })

    it('issues a fetch request for the data when the user is defined', async () => {
      const result = cloudDataSource.executeRemoteGraphQL({
        document: FAKE_USER_QUERY,
        variables: {},
        operationType: 'query',
      })

      const resolved = await result

      expect(resolved.data).to.eql(FAKE_USER_RESPONSE.data)
    })

    it('only issues a single fetch if the operation is called twice', async () => {
      const result1 = cloudDataSource.executeRemoteGraphQL({
        document: FAKE_USER_QUERY,
        variables: {},
        operationType: 'query',
      })
      const result2 = cloudDataSource.executeRemoteGraphQL({
        document: FAKE_USER_QUERY,
        variables: {},
        operationType: 'query',
      })

      expect(result1).to.eq(result2)

      const resolved = await result1

      expect(resolved.data).to.eql(FAKE_USER_RESPONSE.data)
      expect(fetchStub).to.have.been.calledOnce
    })

    it('resolves eagerly with the cached data if the data has already been resolved', async () => {
      const result = cloudDataSource.executeRemoteGraphQL({
        document: FAKE_USER_QUERY,
        variables: {},
        operationType: 'query',
      })

      await result

      const immediateResult = cloudDataSource.executeRemoteGraphQL({
        document: FAKE_USER_QUERY,
        variables: {},
        operationType: 'query',
      })

      expect((immediateResult as ExecutionResult).data).to.eql(FAKE_USER_RESPONSE.data)
      expect(fetchStub).to.have.been.calledOnce
    })

    it('when there is a nullable field missing, resolves eagerly with the cached data, but issues the remote query', async () => {
      const result = cloudDataSource.executeRemoteGraphQL({
        document: FAKE_USER_QUERY,
        variables: {},
        operationType: 'query',
      })

      await result

      fetchStub.resolves(new Response(JSON.stringify(FAKE_USER_WITH_OPTIONAL_RESOLVED_RESPONSE), { status: 200 }))

      const immediateResult = cloudDataSource.executeRemoteGraphQL({
        document: FAKE_USER_WITH_OPTIONAL_MISSING,
        variables: {},
        operationType: 'query',
      })

      expect(immediateResult).not.to.be.instanceOf(Promise)

      expect((immediateResult as CloudDataResponse).data).to.eql(FAKE_USER_WITH_OPTIONAL_MISSING_RESPONSE.data)
      expect((immediateResult as CloudDataResponse).stale).to.eql(true)

      const executingResponse = await (immediateResult as CloudDataResponse).executing

      expect(executingResponse.data).to.eql(FAKE_USER_WITH_OPTIONAL_RESOLVED_RESPONSE.data)

      expect(fetchStub).to.have.been.calledTwice
    })

    it('when there is a non-nullable field missing, issues the remote query immediately', async () => {
      const result = cloudDataSource.executeRemoteGraphQL({
        document: FAKE_USER_QUERY,
        variables: {},
        operationType: 'query',
      })

      await result

      fetchStub.resolves(new Response(JSON.stringify(FAKE_USER_WITH_REQUIRED_RESOLVED_RESPONSE), { status: 200 }))

      const requiredResult = cloudDataSource.executeRemoteGraphQL({
        document: FAKE_USER_WITH_REQUIRED_MISSING,
        variables: {},
        operationType: 'query',
      })

      expect(requiredResult).to.be.instanceOf(Promise)

      expect((await requiredResult).data).to.eql(FAKE_USER_WITH_REQUIRED_RESOLVED_RESPONSE.data)

      expect(fetchStub).to.have.been.calledTwice
    })
  })

  describe('isResolving', () => {
    it('returns false if we are not currently resolving the request', () => {
      const result = cloudDataSource.isResolving({
        document: FAKE_USER_QUERY,
        variables: {},
      })

      expect(result).to.eql(false)
    })

    it('returns true if we are currently resolving the request', () => {
      cloudDataSource.executeRemoteGraphQL({
        document: FAKE_USER_QUERY,
        variables: {},
        operationType: 'query',
      })

      const result = cloudDataSource.isResolving({
        document: FAKE_USER_QUERY,
        variables: {},
      })

      expect(result).to.eql(true)
    })
  })

  describe('hasResolved', () => {
    it('returns false if we have not resolved the data yet', () => {
      const result = cloudDataSource.hasResolved({
        document: FAKE_USER_QUERY,
        variables: {},
      })

      expect(result).to.eql(false)
    })

    it('returns true if we have resolved the data for the query', async () => {
      await cloudDataSource.executeRemoteGraphQL({
        document: FAKE_USER_QUERY,
        variables: {},
        operationType: 'query',
      })

      const result = cloudDataSource.hasResolved({
        document: FAKE_USER_QUERY,
        variables: {},
      })

      expect(result).to.eql(true)
    })
  })

  describe('invalidate', () => {
    it('allows us to issue a cache.invalidate on individual fields in the cloud schema', async () => {
      await cloudDataSource.executeRemoteGraphQL({
        document: FAKE_USER_QUERY,
        variables: {},
        operationType: 'query',
      })

      expect(cloudDataSource.hasResolved({
        document: FAKE_USER_QUERY,
        variables: {},
      })).to.eq(true)

      await cloudDataSource.invalidate('Query', 'cloudViewer')

      expect(cloudDataSource.hasResolved({
        document: FAKE_USER_QUERY,
        variables: {},
      })).to.eq(false)
    })
  })

  describe('delegateCloudField', () => {
    it('delegates a field to the remote schema, which calls executeRemoteGraphQL', async () => {
      fetchStub.resolves(new Promise((resolve) => {
        setTimeout(() => {
          resolve(new Response(JSON.stringify(CLOUD_PROJECT_RESPONSE), { status: 200 }))
        }, 200)
      }))

      Object.defineProperty(ctx, 'cloud', { value: cloudDataSource })

      const dir = await scaffoldProject('component-tests')

      const delegateCloudField = cloudDataSource.delegateCloudField

      const delegateCloudSpy = sinon.stub(cloudDataSource, 'delegateCloudField').callsFake(async function () {
        return delegateCloudField.apply(this, arguments)
      })

      await ctx.actions.project.setCurrentProject(dir)

      sinon.stub(ctx.project, 'projectId').resolves('abc1234')

      const result = await execute({
        rootValue: {},
        document: CLOUD_PROJECT_QUERY,
        schema: ctx.schema,
        contextValue: ctx,
      })

      expect(delegateCloudSpy).to.have.been.calledOnce

      expect(result.data).to.eql({
        currentProject: {
          cloudProject: null,
          id: 'Q3VycmVudFByb2plY3Q6L3ByaXZhdGUvdmFyL2ZvbGRlcnMvMHovcjE5N19zMm41ejdkMTJrOHM1dDBtdGZ3MDAwMGduL1QvY3ktcHJvamVjdHMvY29tcG9uZW50LXRlc3Rz',
        },
      })

      expect(await delegateCloudSpy.firstCall.returnValue)

      const result2 = await execute({
        rootValue: {},
        document: CLOUD_PROJECT_QUERY,
        schema: ctx.schema,
        contextValue: ctx,
      })

      expect(result2.data).to.eql({
        currentProject: {
          cloudProject: {
            __typename: 'CloudProject',
            id: '1',
          },
          id: 'Q3VycmVudFByb2plY3Q6L3ByaXZhdGUvdmFyL2ZvbGRlcnMvMHovcjE5N19zMm41ejdkMTJrOHM1dDBtdGZ3MDAwMGduL1QvY3ktcHJvamVjdHMvY29tcG9uZW50LXRlc3Rz',
        },
      })

      expect(fetchStub).to.have.been.calledOnce
    })
  })
})

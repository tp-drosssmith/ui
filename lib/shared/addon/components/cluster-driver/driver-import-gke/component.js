import Component from '@ember/component';
import {
  computed, get, observer, set, setProperties
} from '@ember/object';
import { alias, equal, union } from '@ember/object/computed';
import { next } from '@ember/runloop';
import { inject as service } from '@ember/service';
import { isEmpty } from '@ember/utils';
import { all } from 'rsvp';
import ClusterDriver from 'shared/mixins/cluster-driver';
import { sortableNumericSuffix } from 'shared/utils/util';
import layout from './template';


export default Component.extend(ClusterDriver, {
  globalStore: service(),
  growl:       service(),
  settings:    service(),
  intl:        service(),
  google:      service(),

  layout,

  configField:           'gkeConfig',
  step:                  1,
  loading:               false,
  nodeForInfo:           null,
  loadingClusters:       false,
  loadFailedAllClusters: false,
  regionChoices:         null,
  errors:                null,
  otherErrors:           null,
  clusterErrors:         null,
  selectedCred:          null,
  isPostSave:            false,
  config:                null,
  zones:                 null,
  locationType:          null,

  isEdit:       equal('mode', 'edit'),
  clusterState: alias('model.originalCluster.state'),

  allErrors: union('errors', 'otherErrors', 'clusterErrors'),

  init() {
    this._super(...arguments);

    setProperties(this, {
      errors:        [],
      clusterErrors: [],
      otherErrors:   [],
      zones:         [],
      locationType:  this.google.defaultRegionType,
      regionChoices: this.google.regions.map((region) => ({ name: region })),
    });

    if (this.isEdit) {
      const cloudCredId = get(this, 'model.cluster.gkeConfig.googleCredentialSecret');
      const cloudCred = (this.model.cloudCredentials || []).find((cc) => cc.id === cloudCredId);

      if (!isEmpty(cloudCred)) {
        next(() => {
          this.send('finishAndSelectCloudCredential', cloudCred);
        });
      }
    } else {
      this.bootstrapGkeV2Cluster();
    }
  },

  actions: {
    clickNext() {},
    finishAndSelectCloudCredential(cred) {
      if (isEmpty(cred)) {
        set(this, 'config.googleCredentialSecret', null);
        set(this, 'selectedCred', null);
      } else {
        set(this, 'config.googleCredentialSecret', cred.id);
        set(this, 'selectedCred', cred);

        this.send('checkServiceAccount');
      }
    },
    checkServiceAccount(cb) {
      set(this, 'errors', []);

      const config = get(this, `cluster.${ this.configField }`);

      return all([
        this.google.fetchZones(config, this.saved),
      ]).then((resp) => {
        const [zones] = resp;

        setProperties(this, {
          step: 2,
          zones,
        });

        if (cb) {
          cb(true)
        }
      }).catch((err) => {
        this.send('errorHandler', err);

        if (cb) {
          cb(false)
        }
      });
    },
    async loadClusters(cb) {
      const errors   = [];
      let step       = 3;
      let allClusters;

      set(this, 'loadingClusters', true);

      try {
        const config = get(this, `cluster.${ this.configField }`);

        allClusters = await this.google.fetchClusters(config, this.saved ?? false);

        setProperties(this, {
          allClusters: (allClusters || []).map((c) => {
            return {
              label: c.name,
              value: c.name
            };
          }),
          step,
        });

        setProperties(this, {
          loadingClusters: false,
          step,
        });

        if (cb) {
          cb()
        }
      } catch (err) {
        errors.pushObject(`Failed to load Clusters from GKE: ${ err.message }`);

        // EKS List Clusters API fails sometimes to list this, user cnn input a cluster name though so dont fail
        setProperties(this, {
          loadFailedAllClusters: true,
          errors
        });

        if (cb) {
          cb(false, err);
        }
      } finally {
        setProperties(this, {
          loadingClusters: false,
          step,
        });
      }
    },
  },

  locationOrZoneChanged: observer('locationType', 'config.{region,zone}', function() {
    const { config, locationType } = this;

    if (locationType === 'zonal') {
      if (!isEmpty(get(config, 'region'))) {
        delete this.config.region;
      }

      set(this, 'config.zone', 'us-west2-a');

      if (!isEmpty(config?.zone)) {
        this.send('loadClusters');
      }
    } else {
      if (!isEmpty(get(config, 'zone'))) {
        delete this.config.zone;
      }

      set(this, 'config.region', 'us-west2');

      if (!isEmpty(config?.region)) {
        this.send('loadClusters');
      }
    }
  }),

  zoneChoices: computed('zones.[]', function() {
    let out = (get(this, 'zones') || []).slice();

    out.forEach((obj) => {
      setProperties(obj, {
        sortName:    sortableNumericSuffix(obj.name),
        displayName: `${ obj.name  } (${  obj.description  })`,
        disabled:    obj.status.toLowerCase() !== 'up',
      });
    });

    return out.sortBy('sortName')
  }),

  disableImport: computed('step', 'config.{googleCredentialSecret,clusterName}', function() {
    const { step, config: { googleCredentialSecret, clusterName } } = this;

    if (step <= 3 && !isEmpty(googleCredentialSecret) && !isEmpty(clusterName)) {
      return false;
    }

    return true;
  }),

  cloudCredentials: computed('model.cloudCredentials', function() {
    const { model: { cloudCredentials } } = this;

    return cloudCredentials.filter((cc) => Object.prototype.hasOwnProperty.call(cc, 'googlecredentialConfig'));
  }),

  doneSaving() {
    const {
      isPostSave,
      model: {
        cluster: {
          gkeConfig = {},
          gkeStatus = {},
        }
      }
    } = this;
    const privateEndpoint = get(gkeConfig, 'privateClusterConfig.enablePrivateEndpoint') || get(gkeStatus, 'upstreamSpec.privateClusterConfig.enablePrivateEndpoint') || false;

    if (isPostSave && privateEndpoint) {
      set(this, 'step', 4);

      return;
    }

    if (this.close) {
      this.close();
    }
  },

  bootstrapGkeV2Cluster() {
    const gkeConfig = this.globalStore.createRecord({
      clusterName:       '',
      imported:          true,
      region:            'us-west2',
      type:              'gkeclusterconfigspec',
    });

    set(this, 'model.cluster.gkeConfig', gkeConfig);
    set(this, 'config', gkeConfig);
  },

});
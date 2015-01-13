import Ember from 'ember';

export default Ember.Controller.extend({
  queryParams: ['timedOut'],

  timedOut: false,
  waiting: false,
  errorMsg: null,

  infoColor: function() {
    if ( this.get('errorMsg') )
    {
      return 'alert-warning';
    }
    {
      return 'alert-info';
    }
  }.property('errorMsg'),

  infoMsg: function() {
    if ( this.get('errorMsg') )
    {
      return this.get('errorMsg');
    }
    else if ( this.get('timedOut') )
    {
      return 'Your session has timed out.  Log in again to continue.';
    }
    else
    {
      return '';
    }
  }.property('timedOut','waiting','errorMsg'),

  actions: {
    authenticate: function() {
      var self = this;
      var session = self.get('session');
      var app = self.get('app');

      self.set('timedOut', false);
      self.set('waiting', true);

      self.get('torii').open('github-oauth2',{width: 1024, height: 500}).then(function(github){
        return self.get('store').rawRequest({
          url: 'token',
          method: 'POST',
          data: {
            code: github.authorizationCode,
          }
        }).then(function(res) {
          var auth = JSON.parse(res.xhr.responseText);
          session.set('token', auth.jwt);
          session.set('isLoggedIn',1);
          var transition = app.get('afterLoginTransition');
          if ( transition )
          {
            app.set('afterLoginTransition', null);
            transition.retry();
          }
          else
          {
            self.transitionToRoute('index');
          }
        });
      })
      .catch(function(res) {
        if ( res.xhr && res.xhr.responseText )
        {
          var body = JSON.parse(res.xhr.responseText);
          self.set('errorMsg', body.message);
        }
        else
        {
          self.set('errorMsg', res.err);
        }
      }).finally(function() {
        self.set('waiting', false);
      });
    }
  }
});

